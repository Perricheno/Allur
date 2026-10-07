import { useState } from 'preact/hooks';
import { html, Icon, count, delayText, clockAt, time, duration } from './lib.js';
import { app, act, updateUi, go, href } from './store.js';
import { Button, Badge, Empty, Segmented } from './ui.js';

const SPEEDS = [25, 40, 60];

function Metric({ label, value, bad }) {
  return html`<div class=${`metric ${bad ? 'bad' : ''}`}><span>${label}</span><strong>${value}</strong></div>`;
}

function Variants({ data }) {
  const { dispatch } = data;
  const approved = data.planApproved;
  return html`<div class="variants" role="radiogroup" aria-label="Варианты пропуска поездов">
    ${dispatch.variants.map(v => {
      const on = dispatch.selected === v.id;
      return html`<label class=${`variant ${on ? 'on' : ''} ${approved ? 'locked' : ''}`} key=${v.id}>
        <input type="radio" name="variant" class="sr-only" checked=${on} disabled=${approved || app.busy || !app.online}
          onChange=${() => act({ type: 'variant', variantId: v.id })} />
        <span class="variant-head"><strong>${v.name}</strong>${v.recommended && html`<${Badge} tone="accent" icon="zap">Рекомендуется</${Badge}>`}</span>
        <span class="variant-metrics">
          <${Metric} label="Пассажирские" value=${v.metrics.passenger ? `+${v.metrics.passenger} мин` : '0'} bad=${v.metrics.passenger > 0} />
          <${Metric} label="Все поезда" value=${`+${v.metrics.total} мин`} />
          <${Metric} label="Задержано" value=${`${v.metrics.delayedTrains} из ${data.trains.length}`} />
        </span>
        <span class="variant-desc">${v.description}</span>
        ${on && html`<span class="order" aria-label="Очерёдность проследования перегона">
          <small>Очерёдность:</small>
          ${v.order.slice(0, 8).map(o => html`<span key=${o.train} class=${`chip p${o.priority}`} title=${`${o.label}, ${o.dir === 'even' ? 'чётное' : 'нечётное'} направление, ${delayText(o.delay)}`}>${o.train}</span>`)}
          ${v.order.length > 8 && html`<small>+${v.order.length - 8}</small>`}
        </span>`}
      </label>`;
    })}
  </div>`;
}

function Conflicts({ data }) {
  const [open, setOpen] = useState(false);
  const list = data.dispatch.conflicts;
  return html`<div class="conflicts">
    <button type="button" class="conflicts-toggle" aria-expanded=${open} onClick=${() => setOpen(!open)}>
      <${Icon} name="triangle-alert" size=${16} />${count(list.length, ['встречный конфликт', 'встречных конфликта', 'встречных конфликтов'])} на одном пути
      <${Icon} name=${open ? 'chevron-up' : 'chevron-down'} size=${15} class="chev" /></button>
    ${open && html`<ul>
      ${list.slice(0, 8).map((c, i) => html`<li key=${i}>
        <button type="button" class="link" onClick=${() => { updateUi({ selectedTrain: c.a.priority <= c.b.priority ? c.a.train : c.b.train }); go('/overview?route=corridor'); }}>
          <strong>№${c.a.train}</strong> (${c.a.label}) × <strong>№${c.b.train}</strong> (${c.b.label})</button>
        <small>оба на перегоне около ${clockAt(data, Math.max(c.a.enter, c.b.enter))}</small>
      </li>`)}
      ${list.length > 8 && html`<li><small>…и ещё ${list.length - 8}. Все они учтены в расчёте вариантов.</small></li>`}
    </ul>`}
  </div>`;
}

const TRACKS = { odd: 'нечётный путь', even: 'чётный путь', both: 'оба пути' };
const closureText = (data, c) => `перегон ${data.stations[c.segment].id}–${data.stations[c.segment + 1].id}: ${TRACKS[c.track]}${c.kind === 'breakdown' ? ' (поломка поезда)' : ''}`;

/** Выбор варианта пропуска и подтверждение. */
export function IncidentPanel({ data }) {
  const { dispatch } = data;
  const nowMin = (data.now - data.baseTime) / 60000;
  return html`<section class="panel decisions" aria-labelledby="inc-title">
    <div class="panel-head"><h2 id="inc-title">Варианты пропуска</h2><${Badge} tone="danger" icon="siren">${count(dispatch.closures.length, ['закрытие', 'закрытия', 'закрытий'])}</${Badge}></div>
    <ul class="closure-list">${dispatch.closures.map(c => html`<li key=${c.id}><${Icon} name=${c.kind === 'breakdown' ? 'ambulance' : 'siren'} size=${16} />
      <span><strong>${closureText(data, c)}</strong>${c.from > nowMin ? ` · с ${clockAt(data, c.from)}` : ''}${c.until == null ? ' · до отмены' : ` · до ${clockAt(data, c.until)}`}${c.auto ? ' · возникло само' : ''}</span></li>`)}</ul>
    <p class="incident-line">Поезда закрытого направления идут по соседнему пути против обычного направления, встречные не могут быть на нём одновременно. Если закрыты оба пути, поезда ждут снятия закрытия.</p>
    <${Conflicts} data=${data} />
    <${Variants} data=${data} />
    <p class="why"><${Icon} name="info" size=${15} /> ${dispatch.why}</p>
    ${data.planApproved
      ? html`<div class="approved" role="status"><${Icon} name="badge-check" size=${20} /><div><strong>План подтверждён</strong><small>Прогноз перестроен, пассажирам отправлены обновлённые времена прибытия.</small></div></div>`
      : html`<${Button} variant="primary" size="lg" icon="check" class="wide" pending=${app.busy} onClick=${() => act({ type: 'approve' })}>Подтвердить вариант «${dispatch.variants.find(v => v.id === dispatch.selected).name}»</${Button}>
        ${data.auto.approve && html`<small class="muted">Автопилот включён: если не вмешаться, рекомендованный вариант применится через 15 минут после закрытия.</small>`}`}
  </section>`;
}

/** Ввод событий: закрытие пути, ограничения скорости; перечень действующих происшествий. */
export function Scenarios({ data, bare = false }) {
  const [segment, setSegment] = useState(String(data.dispatch.closedSegment));
  const [track, setTrack] = useState('odd');
  const [minutes, setMinutes] = useState('0');
  const [rsegment, setRSegment] = useState(String(data.dispatch.closedSegment + 1));
  const [kmh, setKmh] = useState('25');
  const segs = data.stations.slice(0, -1).map((s, i) => ({ i, label: `${s.id}–${data.stations[i + 1].id} · ${s.name} — ${data.stations[i + 1].name}` }));
  const Wrap = bare ? 'div' : 'section';
  const nowMin = (data.now - data.baseTime) / 60000;
  const incidents = data.incidents;
  return html`<${Wrap} class=${bare ? 'events-bare' : 'panel'} aria-labelledby=${bare ? undefined : 'ev-title'}>
    ${!bare && html`<div class="panel-head"><h2 id="ev-title">События на участке</h2><${Icon} name="construction" size=${18} /></div>`}
    <div class="event-card col automation">
      <div><h3>Автоматика</h3><p class="muted">Данные создаются сами: поломки, плановые окна и ограничения скорости случаются случайно, станции принимают вагоны, автопилот применяет рекомендацию.</p></div>
      <div class="field-row">
        <label>События
          <${Segmented} label="Интенсивность случайных событий" value=${data.auto.intensity} onChange=${v => act({ type: 'auto', intensity: v })}
            options=${[{ value: 'off', label: 'Выкл' }, { value: 'low', label: 'Редкие' }, { value: 'normal', label: 'Обычные' }, { value: 'high', label: 'Частые' }]} /></label>
      </div>
      <div class="field-row checks">
        <label class="check"><input type="checkbox" checked=${data.auto.stations} onChange=${e => act({ type: 'auto', stations: e.target.checked })} /> Станции работают сами</label>
        <label class="check"><input type="checkbox" checked=${data.auto.approve} onChange=${e => act({ type: 'auto', approve: e.target.checked })} /> Автопилот: применять рекомендацию через 15 мин</label>
      </div>
    </div>
    <div class="event-card col">
      <div><h3>Закрыть путь на перегоне</h3><p class="muted">Сход, ремонт, авария. Поезда закрытого пути пойдут по соседнему, система предложит варианты пропуска.</p></div>
      <div class="field-row">
        <label>Перегон
          <select value=${segment} onChange=${e => setSegment(e.target.value)} aria-label="Перегон для закрытия">${segs.map(s => html`<option key=${s.i} value=${s.i}>${s.label}</option>`)}</select></label>
        <label>Путь
          <select value=${track} onChange=${e => setTrack(e.target.value)} aria-label="Какой путь закрыть"><option value="odd">нечётный</option><option value="even">чётный</option><option value="both">оба пути</option></select></label>
        <label>Надолго
          <select value=${minutes} onChange=${e => setMinutes(e.target.value)} aria-label="Длительность закрытия"><option value="0">до отмены</option><option value="30">30 мин</option><option value="60">1 час</option><option value="120">2 часа</option><option value="240">4 часа</option></select></label>
        <${Button} variant="danger-outline" icon="siren" disabled=${track === 'both' && minutes === '0'} reason="Для закрытия обоих путей выберите длительность"
          onClick=${() => act({ type: 'close', segment: Number(segment), track, minutes: Number(minutes) || undefined })}>Закрыть</${Button}>
      </div>
    </div>
    <div class="event-card col">
      <div><h3>Ограничение скорости</h3><p class="muted">После ремонта пути. Время хода растёт пропорционально 80 км/ч ÷ ограничение.</p></div>
      <div class="field-row">
        <label>Перегон
          <select value=${rsegment} onChange=${e => setRSegment(e.target.value)} aria-label="Перегон">${segs.map(s => html`<option key=${s.i} value=${s.i}>${s.label}</option>`)}</select></label>
        <label>км/ч
          <select value=${kmh} onChange=${e => setKmh(e.target.value)} aria-label="Скорость, км/ч">${SPEEDS.map(v => html`<option key=${v} value=${v}>${v}</option>`)}</select></label>
        <${Button} icon="gauge" onClick=${() => act({ type: 'restrict', segment: Number(rsegment), kmh: Number(kmh) })}>Ввести</${Button}>
      </div>
    </div>
    ${incidents.length + data.restrictions.length > 0 && html`<div class="restrictions"><h3>Действующие и запланированные</h3>
      <ul>${incidents.map(i => html`<li key=${i.id}><${Icon} name=${i.kind === 'breakdown' ? 'ambulance' : 'siren'} size=${16} />
        <span><strong>${i.kind === 'breakdown' ? i.label : i.label}</strong>${i.track ? ` · ${closureText(data, i)}` : ' · без закрытия пути'}${i.from > nowMin ? ` · с ${clockAt(data, i.from)}` : ''}${i.until != null ? ` · до ${clockAt(data, i.until)}` : ''}</span>
        ${(i.kind !== 'breakdown' || i.level >= 2) && html`<${Button} variant="ghost" size="sm" icon=${i.kind === 'breakdown' ? 'zap' : 'x'} onClick=${() => act({ type: 'reopen', id: i.id })}>${i.kind === 'breakdown' ? 'Устранить досрочно' : 'Снять'}</${Button}>`}</li>`)}
        ${data.restrictions.map(r => html`<li key=${`r${r.segment}${r.from}`}><${Icon} name="gauge" size=${16} />
          <span><strong>${data.stations[r.segment].id}–${data.stations[r.segment + 1].id}</strong> · ${r.kmh} км/ч${r.from != null && r.from > nowMin ? ` · с ${clockAt(data, r.from)}` : ''}${r.until != null ? ` · до ${clockAt(data, r.until)}` : ''}</span>
          <${Button} variant="ghost" size="sm" icon="x" onClick=${() => act({ type: 'unrestrict', segment: r.segment })}>Снять</${Button}></li>`)}</ul></div>`}
  </${Wrap}>`;
}

export function PassengerNotices({ data, limit = 5 }) {
  const list = data.notifications.slice(0, limit);
  return html`<section class="panel" aria-labelledby="pn-title">
    <div class="panel-head"><h2 id="pn-title">Уведомления пассажирам</h2><${Icon} name=${list.length ? 'bell-ring' : 'bell'} size=${18} /></div>
    ${list.length ? html`<ul class="notices">${list.map((n, i) => html`<li key=${i}>
      <${Icon} name=${n.delay > 0 ? 'bell-ring' : 'circle-check'} size=${16} />
      <div><p>${n.text}</p><small><time>${time(n.at)}</time> · отправлено в пассажирские информационные системы</small></div></li>`)}</ul>`
      : html`<${Empty} icon="bell" title="Пока без уведомлений">Когда прогноз опоздания пассажирского поезда изменится на 5 минут и больше, пассажиры получат сообщение автоматически.</${Empty}>`}
  </section>`;
}

/** Короткая сводка для главной: что требует внимания. */
export function AttentionCard({ data }) {
  const { dispatch } = data;
  const need = data.blocked && !data.planApproved;
  const tone = need ? 'danger' : data.blocked || data.restrictions.length ? 'accent' : 'neutral';
  const rec = dispatch.variants.find(v => v.recommended);
  return html`<section class=${`panel attention attention-${tone}`} aria-labelledby="att-title">
    <div class="panel-head"><h2 id="att-title">Требует решения</h2>
      <${Badge} tone=${need ? 'danger' : 'neutral'} icon=${need ? 'siren' : 'circle-check'}>${need ? 'Да' : 'Нет'}</${Badge}></div>
    ${need ? html`<p>${count(dispatch.closures.length, ['закрыт перегон', 'закрыто перегона', 'закрыто перегонов'])}: <strong>${count(dispatch.conflicts.length, ['конфликт', 'конфликта', 'конфликтов'])}</strong>. Рекомендуем вариант «${rec.name}»: пассажирские +${rec.metrics.passenger} мин.</p>
        <${Button} variant="primary" iconRight="arrow-right" onClick=${() => go('/decisions')}>Перейти к решению</${Button}>`
      : data.blocked ? html`<p>План подтверждён: «${dispatch.variants.find(v => v.id === dispatch.selected).name}». Прогноз перестроен.</p>
        <${Button} iconRight="arrow-right" onClick=${() => go('/decisions')}>Подробнее</${Button}>`
      : data.restrictions.length ? html`<p>Действует ограничений скорости: ${data.restrictions.length}. Прогноз затронутых поездов пересчитан автоматически.</p>
        <${Button} iconRight="arrow-right" onClick=${() => go('/decisions')}>Посмотреть</${Button}>`
      : html`<p class="muted">Движение идёт по графику. Чтобы увидеть работу системы, введите событие или спроецируйте поломку на панели диспетчера.</p>
        <div class="btn-row"><${Button} icon="construction" onClick=${() => go('/decisions')}>Ввести событие</${Button}><${Button} variant="ghost" icon="book-open" onClick=${() => go('/how')}>Как это работает</${Button}></div>`}
  </section>`;
}

export function LateList({ data }) {
  const late = [...data.trains].filter(t => t.delay > 0).sort((a, b) => b.delay - a.delay).slice(0, 6);
  return html`<section class="panel" aria-labelledby="late-title">
    <div class="panel-head"><h2 id="late-title">Больше всего опаздывают</h2><a href=${href('/trains')}>Все поезда</a></div>
    ${late.length ? html`<ul class="late-list">${late.map(t => html`<li key=${t.number}>
      <button type="button" class="late-row" onClick=${() => updateUi({ selectedTrain: app.ui.selectedTrain === t.number ? null : t.number })} aria-pressed=${app.ui.selectedTrain === t.number}>
        <strong>№${t.number}</strong><span>${t.label}</span><span class="bad num">+${t.delay} мин</span></button></li>`)}</ul>`
      : html`<${Empty} icon="circle-check" title="Опозданий нет">Все поезда идут по графику.</${Empty}>`}
  </section>`;
}
