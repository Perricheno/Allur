// События на маршруте: создание, список, сравнение вариантов пропуска и подтверждение.
import { useMemo, useState } from 'preact/hooks';
import { html, Icon, time, count } from './lib.js';
import { Badge, Button, Empty, Segmented } from './ui.js';
import { incidentAction } from './network-incidents.js';
import { incidentVariants, isSingleTrack, WRONG_TRACK_KMH } from './network-sim.js';
import { routeSegments } from './route-profile.js';

const KINDS = [{ value: 'closure', label: 'Закрыть путь', icon: 'siren' }, { value: 'restriction', label: 'Ограничение скорости', icon: 'gauge' }, { value: 'breakdown', label: 'Поломка поезда', icon: 'ambulance' }];
const DURATIONS = [{ v: 30, l: '30 мин' }, { v: 60, l: '1 час' }, { v: 120, l: '2 часа' }, { v: 240, l: '4 часа' }, { v: 480, l: '8 часов' }, { v: 0, l: 'до отмены' }];
const LEVELS = [
  { v: 1, name: 'Уровень 1 · незначительная', text: 'Осмотр на месте, поезд стоит около 15 минут. Другие поезда не мешают друг другу.', min: 15 },
  { v: 2, name: 'Уровень 2 · средняя', text: 'Ремонт около 45 минут. Следующие за ним поезда стоят в блок-участке и ждут.', min: 45 },
  { v: 3, name: 'Уровень 3 · серьёзная', text: 'Около 2 часов. Путь закрыт, оба направления идут по соседнему на 40 км/ч по одному.', min: 120 },
  { v: 4, name: 'Уровень 4 · авария', text: 'Около 4 часов. Закрыты оба пути, движение возобновляется после восстановления.', min: 240 },
];
const ageText = (i, now) => (i.from > now ? `начнётся в ${time(i.from)}` : i.until == null ? 'до отмены' : `до ${time(i.until)} (осталось ${Math.max(1, Math.ceil((i.until - now) / 60000))} мин)`);
const kindName = i => (i.kind === 'closure' ? (i.track === 'both' ? 'Закрыты оба пути' : i.track === 'odd' ? 'Закрыт нечётный путь' : 'Закрыт чётный путь') : i.kind === 'restriction' ? `Ограничение ${i.kmh} км/ч` : `Поломка поезда №${i.trainNumber}, уровень ${i.level}`);

function whyText(vs) {
  const best = vs.variants.find(v => v.recommended), others = vs.variants.filter(v => !v.recommended).sort((a, b) => b.metrics.weighted - a.metrics.weighted), worst = others[0];
  if (!worst || worst.metrics.weighted === best.metrics.weighted) return `«${best.name}» не хуже остальных: все варианты дают одинаковую взвешенную задержку (${best.metrics.weighted}).`;
  const fifo = vs.variants.find(v => v.id === 'fifo');
  return `«${best.name}» даёт наименьшую взвешенную задержку: ${best.metrics.weighted} против ${worst.metrics.weighted} у «${worst.name}»${fifo && fifo !== best ? ` и ${fifo.metrics.weighted} при пропуске по очереди подхода` : ''}. Пассажирские теряют ${best.metrics.passenger} мин (у «${worst.name}» — ${worst.metrics.passenger}).`;
}

function Variants({ sim, inc, now }) {
  const vs = useMemo(() => incidentVariants(sim, inc), [sim, inc]);
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const [pick, setPick] = useState(null);
  if (!vs) return null;
  if (vs.mode === 'slow' || vs.mode === 'owner') return html`<p class="muted">${vs.mode === 'slow' ? 'Ограничение скорости только замедляет проезд, выбирать очерёдность не нужно.' : 'Остановился один поезд, остальные его не ждут.'} Задержка видна в таблице ниже.</p>`;
  const chosen = pick || (inc.approved ? vs.appliedId : vs.recommendedId);
  const best = vs.variants.find(v => v.recommended);
  const max = Math.max(...vs.variants.map(v => v.metrics.weighted), 1);
  const approve = async variantId => { setBusy(true); setErr(''); try { await incidentAction({ type: 'approve', id: inc.id, variant: variantId }); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const current = vs.variants.find(v => v.id === vs.appliedId);
  return html`<div class="variants-box">
    <p class="muted">${inc.approved ? html`Подтверждён вариант <strong>«${current.name}»</strong>.` : html`Пока диспетчер не подтвердил вариант, поезда идут <strong>по очереди подхода</strong>. Рекомендация модели: <strong>«${best.name}»</strong>.`}</p>
    <div class="variant-grid" role="radiogroup" aria-label="Варианты пропуска поездов">
      ${vs.variants.map(v => html`<label key=${v.id} class=${`variant ${chosen === v.id ? 'on' : ''} ${vs.appliedId === v.id && inc.approved ? 'applied' : ''}`}>
        <input type="radio" class="sr-only" name=${`v-${inc.id}`} checked=${chosen === v.id} onChange=${() => setPick(v.id)} />
        <span class="variant-head"><strong>${v.name}</strong>${v.recommended && html`<${Badge} tone="accent" icon="zap">Рекомендуется</${Badge}>`}${inc.approved && vs.appliedId === v.id && html`<${Badge} icon="badge-check">Применён</${Badge}>`}</span>
        <span class="variant-metrics"><span><small>Пассажирские</small><b>${v.metrics.passenger ? `+${v.metrics.passenger} мин` : '0'}</b></span><span><small>Все поезда</small><b>+${v.metrics.total} мин</b></span><span><small>Задержано</small><b>${v.metrics.delayed}</b></span><span><small>Взвешенная</small><b>${v.metrics.weighted}</b></span></span>
        <i class="cost-bar" style=${`width:${Math.max(3, v.metrics.weighted / max * 100)}%`}></i>
        <span class="variant-desc">${v.description}</span></label>`)}
    </div>
    <p class="model-why"><${Icon} name="lightbulb" size=${16} /><span><strong>Почему так:</strong> ${whyText(vs)} Вес задержки: пассажирский ×10, контейнерный ×2, грузовой ×1.</span></p>
    <div class="btn-row"><${Button} variant="primary" icon="check" pending=${busy} disabled=${inc.approved && chosen === vs.appliedId} reason="Этот вариант уже применён" onClick=${() => approve(chosen)}>Подтвердить «${vs.variants.find(v => v.id === chosen).name}»</${Button}>
      ${chosen !== vs.recommendedId && html`<${Button} variant="ghost" onClick=${() => setPick(vs.recommendedId)}>Выбрать рекомендованный</${Button}>`}</div>
    ${err && html`<p class="bad" role="alert">${err}</p>`}
    ${(() => { const cur = vs.variants.find(v => v.id === chosen); return cur.rows.length ? html`<h4>Кого это затрагивает · вариант «${cur.name}»</h4>
      <div class="table-wrap"><table class="table"><thead><tr><th scope="col">Поезд</th><th scope="col">Тип</th><th scope="col">Подход к зоне</th><th scope="col">Проходит в</th><th scope="col" class="num">Ожидание</th><th scope="col" class="num">Задержка прибытия</th></tr></thead>
        <tbody>${cur.rows.slice(0, 10).map(r => html`<tr key=${r.uid}><td><strong>№${r.number}</strong></td><td>${r.cat === 'passenger' ? 'пассажирский' : r.cat === 'container' ? 'контейнерный' : r.cat === 'owner' ? 'сломавшийся' : 'грузовой'} ${r.dir === 'fwd' ? '→' : '←'}</td>
          <td class="num">${r.enterMs ? time(r.enterMs) : '—'}</td><td class="num">${r.releaseMs ? time(r.releaseMs) : '—'}</td><td class="num">${r.wait} мин</td><td class=${`num ${r.delay >= 15 ? 'bad' : ''}`}>+${r.delay} мин</td></tr>`)}</tbody></table></div>
      ${cur.rows.length > 10 ? html`<p class="muted">…и ещё ${cur.rows.length - 10}</p>` : ''}
      ${(() => { const pass = cur.rows.filter(r => r.cat === 'passenger' && r.delay >= 5); return pass.length ? html`<div class="notice-box"><h4><${Icon} name="bell-ring" size=${15} class="inline" /> Уведомления пассажирам</h4><ul>${pass.slice(0, 5).map(r => html`<li key=${r.uid}>Поезд №${r.number} опаздывает на ${r.delay} мин, ожидаемое проследование зоны в ${time(r.releaseMs)}. Сообщение отправлено в пассажирские информационные системы.</li>`)}</ul></div>` : ''; })()}` : html`<p class="muted">Сейчас в зону никто не попадает.</p>`; })()}
  </div>`;
}

export function IncidentPanel({ sim, route, trains, incidents, now, focusSegment, onFocusSegment }) {
  const segs = useMemo(() => routeSegments(route), [route.id]);
  const single = isSingleTrack(route);
  const [kind, setKind] = useState('closure');
  const [segIdx, setSegIdx] = useState(0);
  const [track, setTrack] = useState('even');
  const [minutes, setMinutes] = useState(120);
  const [kmh, setKmh] = useState(25);
  const [delay, setDelay] = useState(0);
  const [trainUid, setTrainUid] = useState('');
  const [level, setLevel] = useState(2);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const seg = segs[focusSegment ?? segIdx] || segs[0];
  const movers = trains.filter(t => !t.stopped && t.departedMs != null).sort((a, b) => a.number - b.number);
  const chosenTrain = movers.find(t => t.uid === trainUid) || movers[0];
  const create = async () => {
    setBusy(true); setError('');
    try {
      let incident;
      if (kind === 'breakdown') {
        if (!chosenTrain) throw new Error('На маршруте нет движущихся поездов');
        const km = chosenTrain.dir === 'fwd' ? chosenTrain.km : chosenTrain.totalKm - chosenTrain.km;
        incident = { kind, routeId: route.id, a: Math.max(0, km - 0.3), b: Math.min(route.km, km + 0.3), level, trainUid: chosenTrain.uid, trainNumber: chosenTrain.number, track: chosenTrain.dir === 'fwd' ? 'even' : 'odd', minutes: null,
          segName: `рядом с ${Math.round(km)} км` };
      } else {
        incident = { kind, routeId: route.id, a: seg.a, b: seg.b, segName: seg.label, track: single ? 'both' : track, kmh, minutes: minutes || null, delayMin: delay };
      }
      await incidentAction({ type: 'add', incident });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const remove = async id => { try { await incidentAction({ type: 'remove', id }); } catch (e) { setError(e.message); } };
  const mine = incidents.filter(i => i.routeId === route.id && (i.until ?? Infinity) > now - 60000);
  return html`<section class="panel" aria-labelledby="inc-h"><div class="panel-head"><div><h2 id="inc-h">События и решения диспетчера</h2><small>Закрытие пути, ограничение скорости, поломка поезда четырёх уровней. Все видят одно и то же, модель пересчитывает движение сразу.</small></div></div>
    <div class="incident-form">
      <${Segmented} label="Вид события" value=${kind} onChange=${setKind} options=${KINDS} />
      ${kind === 'breakdown' ? html`<div class="field-row">
          <label class="schedule-field"><span>Поезд</span><select value=${chosenTrain?.uid || ''} onChange=${e => setTrainUid(e.target.value)} aria-label="Поезд для поломки">${movers.map(t => html`<option key=${t.uid} value=${t.uid}>№${t.number} · ${t.label.toLowerCase()} · ${Math.round(t.dir === 'fwd' ? t.km : t.totalKm - t.km)} км · ${t.speedKmh} км/ч</option>`)}</select></label></div>
        <div class="level-grid" role="radiogroup" aria-label="Уровень поломки">${LEVELS.map(l => html`<label key=${l.v} class=${`level ${level === l.v ? 'on' : ''} l${l.v}`}><input type="radio" class="sr-only" name="level" checked=${level === l.v} onChange=${() => setLevel(l.v)} /><strong>${l.name}</strong><small>${l.text}</small></label>`)}</div>`
        : html`<div class="field-row">
          <label class="schedule-field"><span>Перегон</span><select value=${focusSegment ?? segIdx} onChange=${e => { setSegIdx(Number(e.target.value)); onFocusSegment?.(Number(e.target.value)); }} aria-label="Перегон">${segs.map(s => html`<option key=${s.i} value=${s.i}>${s.label} · ${Math.round(s.len)} км</option>`)}</select></label>
          ${kind === 'closure' && !single && html`<label class="schedule-field"><span>Путь</span><select value=${track} onChange=${e => setTrack(e.target.value)} aria-label="Какой путь закрыть"><option value="even">чётный (→)</option><option value="odd">нечётный (←)</option><option value="both">оба пути</option></select></label>`}
          ${kind === 'restriction' && html`<label class="schedule-field"><span>Скорость, км/ч</span><select value=${kmh} onChange=${e => setKmh(Number(e.target.value))} aria-label="Скорость, км/ч">${[15, 25, 40, 60].map(v => html`<option key=${v} value=${v}>${v}</option>`)}</select></label>`}
          <label class="schedule-field"><span>Длительность</span><select value=${minutes} onChange=${e => setMinutes(Number(e.target.value))} aria-label="Длительность">${DURATIONS.map(d => html`<option key=${d.v} value=${d.v}>${d.l}</option>`)}</select></label>
          <label class="schedule-field"><span>Начало</span><select value=${delay} onChange=${e => setDelay(Number(e.target.value))} aria-label="Когда начать"><option value="0">сейчас</option><option value="30">через 30 мин</option><option value="60">через 1 час</option><option value="120">через 2 часа</option></select></label>
        </div>
        ${single && kind === 'closure' ? html`<p class="muted">Линия однопутная: закрытие перекрывает единственный путь, поезда ждут снятия.</p>` : kind === 'closure' ? html`<p class="muted">Закрыт один путь — оба направления идут по соседнему, по одному, со скоростью ${WRONG_TRACK_KMH} км/ч. Закрыты оба — поезда ждут снятия.</p>` : html`<p class="muted">Время хода по перегону растёт пропорционально обычной скорости ÷ ограничение.</p>`}`}
      <div class="btn-row"><${Button} variant=${kind === 'restriction' ? 'secondary' : 'danger-outline'} icon=${KINDS.find(k => k.value === kind).icon} pending=${busy}
        disabled=${kind === 'closure' && (single || track === 'both') && !minutes} reason="Для закрытия всех путей выберите длительность" onClick=${create}>Создать событие</${Button}></div>
      ${error && html`<p class="bad" role="alert">${error}</p>`}
    </div>
    <h3>Действующие и запланированные · ${mine.length}</h3>
    ${mine.length ? html`<ul class="incident-list">${mine.map(i => html`<li key=${i.id} class=${`incident ${i.kind}`}>
      <div class="incident-head"><${Icon} name=${i.kind === 'closure' ? 'siren' : i.kind === 'restriction' ? 'gauge' : 'ambulance'} size=${18} /><div><strong>${kindName(i)}</strong><small>${i.segName} · ${ageText(i, now)}</small></div>
        <${Button} size="sm" variant="ghost" icon="x" onClick=${() => remove(i.id)}>Снять</${Button}></div>
      <${Variants} sim=${sim} inc=${i} now=${now} /></li>`)}</ul>` : html`<${Empty} icon="circle-check" title="Событий на маршруте нет">Движение идёт по графику. Создайте событие, чтобы увидеть, как модель перестроит движение и какой вариант пропуска выгоднее.</${Empty}>`}
  </section>`;
}
