import { useEffect, useMemo, useState } from 'preact/hooks';
import { html, Icon, clockAt, count, delayText, duration } from './lib.js';
import { Button, Badge, Segmented, Tabs } from './ui.js';
import { loadEngine, makeState, snap, crossings } from './engine.js';
import { usePlayer, PlayerControls } from './how-problem.js';
import { Gantt } from './gantt.js';

/** Загрузка движка в браузере (один раз). */
function useEngine() {
  const [engine, setEngine] = useState(null);
  useEffect(() => { loadEngine().then(setEngine); }, []);
  return engine;
}

const PRIO_CLASS = { 1: 'b-acc', 2: 'b-ink', 3: 'b-gray' };

/**
 * Диаграмма занятия перегона: по строке на поезд, по горизонтали время.
 * Красная часть — ожидание на станции; красная рамка — встречные одновременно на одном пути.
 */
export function LaneChart({ data, rows, from, t0, t1, compact = false, showConflicts = false, animate = false }) {
  const bars = useMemo(() => {
    const cur = new Map(crossings(data).map(b => [b.n, b]));
    return rows.map(r => ({ ...r, cur: cur.get(r.n) || r }));
  }, [data, rows]);
  const [ready, setReady] = useState(!animate);
  useEffect(() => { if (animate) { setReady(false); const id = setTimeout(() => setReady(true), 350); return () => clearTimeout(id); } }, [animate, data]);
  const W = 760, left = compact ? 6 : 64, rowH = compact ? 14 : 26, top = compact ? 4 : 28;
  const plotW = W - left - 8;
  const x = m => left + ((m - t0) / (t1 - t0)) * plotW;
  const height = top + bars.length * rowH + 6;
  const pos = b => (ready ? b.cur : (from?.get(b.n) || b));
  const clash = new Set();
  if (showConflicts) {
    for (const a of bars) for (const b of bars) {
      const A = pos(a), B = pos(b);
      if (a.n < b.n && a.dir !== b.dir && A.enter < B.exit + 3 && B.enter < A.exit + 3) { clash.add(a.n); clash.add(b.n); }
    }
  }
  const ticks = [];
  for (let m = Math.ceil(t0 / 30) * 30; m <= t1; m += 30) ticks.push(m);
  return html`<svg class=${`lanes ${compact ? 'compact' : ''}`} viewBox=${`0 0 ${W} ${height}`} role="img"
    aria-label=${`Занятие перегона: ${bars.length} поездов${showConflicts ? `, конфликтных ${clash.size}` : ''}`}>
    ${!compact && ticks.map(m => html`<g key=${m}><line x1=${x(m)} x2=${x(m)} y1=${top - 6} y2=${height - 4} class="lg"/><text x=${x(m)} y="16" text-anchor="middle" class="lt">${clockAt(data, m)}</text></g>`)}
    ${bars.map((b, i) => {
      const p = pos(b), y = top + i * rowH, w = Math.max(2, x(p.exit) - x(p.enter));
      const wait = Math.max(0, p.enter - b.enter);
      return html`<g key=${b.n} class=${`lane ${clash.has(b.n) ? 'conflict' : ''}`} style=${`transform:translateY(${y}px)`}>
        ${!compact && html`<text x="4" y=${rowH / 2 + 4} class="ln">№${b.n}</text>`}
        ${wait > 0 && html`<rect class="wait" x=${x(b.enter)} y="3" width=${Math.max(1, x(b.enter + wait) - x(b.enter))} height=${rowH - 6} rx="3"/>`}
        <g class="bar" style=${`transform:translateX(${x(p.enter)}px)`}>
          <rect width=${w} y="3" height=${rowH - 6} rx=${compact ? 2 : 5} class=${PRIO_CLASS[b.priority]}/>
          ${!compact && w > 44 && html`<text x="8" y=${rowH / 2 + 4} class="bt">${b.dir === 'even' ? '→' : '←'} ${b.label.split(' ')[0]}</text>`}
        </g></g>`;
    })}
  </svg>`;
}

const rowsFrom = (data, n = 10) => crossings(data).slice(0, n);
const windowOf = (datas, rows) => {
  let lo = Infinity, hi = -Infinity;
  for (const d of datas) for (const b of crossings(d).filter(c => rows.some(r => r.n === c.n))) { lo = Math.min(lo, b.enter); hi = Math.max(hi, b.exit); }
  return [Math.floor((lo - 10) / 10) * 10, Math.ceil((hi + 10) / 10) * 10];
};

const STEPS = [
  { icon: 'eye', title: 'Получаем обстановку', text: 'Система знает нитки всех поездов, приоритеты, пути и ограничения. Пока движение идёт по двум путям, встречные друг другу не мешают.' },
  { icon: 'siren', title: 'Находим конфликты', text: 'Диспетчер закрыл нечётный путь. Теперь оба направления идут по одному. Красным отмечены встречные поезда, которые по графику оказались бы на перегоне одновременно.' },
  { icon: 'split', title: 'Строим варианты', text: 'Система не предлагает единственный вариант: каждое правило очерёдности даёт свою раскладку и свои задержки. Сравниваются они на одних и тех же поездах.' },
  { icon: 'scale', title: 'Выбираем лучший', text: 'Для каждого варианта считается взвешенная задержка: минуты пассажирских весят 10, транзитных и контейнерных 2, сборных 1. Побеждает вариант с наименьшим значением.' },
  { icon: 'badge-check', title: 'Диспетчер подтверждает', text: 'Решение принимает человек. После подтверждения прогноз перестраивается: поезда сдвигаются на рассчитанные минуты, ожидание показано красным.' },
  { icon: 'bell-ring', title: 'Пассажиры узнают', text: 'Для каждого пассажирского поезда с опозданием от 5 минут формируется сообщение с новым временем прибытия — автоматически, без звонков диспетчера.' },
];

export function AlgorithmStepper() {
  const engine = useEngine();
  const pl = usePlayer(STEPS.length, 6500, false);
  const m = useMemo(() => {
    if (!engine) return null;
    const base = snap(engine);
    const rows = rowsFrom(snap(engine, [{ type: 'block' }]));
    const baseRows = rows.map(r => crossings(base).find(c => c.n === r.n) || r);
    const variants = ['priority', 'batch', 'fifo'].map(id => snap(engine, [{ type: 'block' }, { type: 'variant', variantId: id }]));
    const approved = snap(engine, [{ type: 'block' }, { type: 'approve' }]);
    const [t0, t1] = windowOf([base, ...variants], baseRows);
    return { base, rows: baseRows, variants, approved, t0, t1, from: new Map(baseRows.map(r => [r.n, r])) };
  }, [engine]);
  if (!m) return html`<div class="demo loading">Загружаем расчётный движок…</div>`;
  const s = STEPS[pl.i];
  const info = m.approved.dispatch;
  const rec = info.variants.find(v => v.recommended);
  const maxW = Math.max(...info.variants.map(v => v.metrics.weighted));
  const passenger = m.approved.notifications.find(n => n.train === '153') || m.approved.notifications.find(n => n.delay > 0);
  return html`<div class="demo stepper">
    <ol class="steps" aria-label="Шаги алгоритма">${STEPS.map((st, k) => html`<li key=${k}><button type="button" class=${`${k === pl.i ? 'on' : ''} ${k < pl.i ? 'done' : ''}`} aria-current=${k === pl.i ? 'step' : undefined} onClick=${() => pl.setI(k)}>
      <span class="sn"><${Icon} name=${k < pl.i ? 'check' : st.icon} size=${15} /></span><span>${st.title}</span></button></li>`)}</ol>
    <div class="stage" aria-live="polite">
      <div class="stage-text"><h3>${pl.i + 1}. ${s.title}</h3><p>${s.text}</p>
        ${pl.i === 1 && html`<${Badge} tone="danger" icon="triangle-alert">${count(info.conflicts.length, ['конфликт', 'конфликта', 'конфликтов'])} за смену; на диаграмме первые ${m.rows.length} поездов</${Badge}>`}
        ${pl.i === 3 && html`<p class="why"><${Icon} name="info" size=${15} /> ${info.why}</p>`}</div>
      <div class="stage-visual">
        ${(pl.i === 0 || pl.i === 1) && html`<${LaneChart} key=${`b${pl.i}`} data=${m.base} rows=${m.rows} t0=${m.t0} t1=${m.t1} showConflicts=${pl.i === 1} />`}
        ${pl.i === 2 && html`<div class="mini-variants">${m.variants.map((d, k) => { const v = d.dispatch.variants[k]; return html`<figure key=${v.id}>
          <figcaption><strong>${v.name}</strong>${v.recommended && html`<${Badge} tone="accent" icon="zap">лучший</${Badge}>`}</figcaption>
          <${LaneChart} data=${d} rows=${m.rows} t0=${m.t0} t1=${m.t1} compact animate from=${m.from} />
          <small>пассажирские +${v.metrics.passenger} мин · всего +${v.metrics.total} мин</small></figure>`; })}</div>`}
        ${pl.i === 3 && html`<div class="score" role="img" aria-label="Взвешенная задержка по вариантам">${info.variants.map(v => html`<div key=${v.id} class=${`score-row ${v.recommended ? 'win' : ''}`}>
          <span>${v.name}</span><div class="score-bar"><i style=${`width:${(v.metrics.weighted / maxW) * 100}%`}></i></div><strong class="num">${v.metrics.weighted}</strong></div>`)}
          <small>Взвешенная задержка: меньше — лучше</small></div>`}
        ${pl.i === 4 && html`<div><${LaneChart} key="ap" data=${m.approved} rows=${m.rows} t0=${m.t0} t1=${m.t1} animate from=${m.from} />
          <div class="mock-confirm"><${Button} variant="primary" icon="badge-check" class="pressed">План подтверждён: «${rec.name}»</${Button}></div></div>`}
        ${pl.i === 5 && html`<div class="phone-wrap"><div class="phone" role="img" aria-label="Уведомление на телефоне пассажира">
          <div class="phone-bar"></div><div class="push"><${Icon} name="bell-ring" size=${18} /><div><strong>Поезд задерживается</strong><p>${passenger?.text ?? 'Поезд идёт по расписанию.'}</p></div></div>
          <div class="push ghost"><${Icon} name="smartphone" size=${18} /><div><strong>Билет · обновлённое время</strong><p>Прибытие обновлено автоматически</p></div></div></div></div>`}
      </div>
    </div>
    <${PlayerControls} player=${pl} length=${STEPS.length} labels=${STEPS.map(x => x.title)} />
  </div>`;
}

// ---------------------------------------------------------------- песочница

export function Sandbox() {
  const engine = useEngine();
  const [rev, setRev] = useState(0);
  const sb = useMemo(() => (engine ? { state: engine.createState() } : null), [engine]);
  const [segment, setSegment] = useState('5');
  const [kmh, setKmh] = useState('25');
  const [err, setErr] = useState('');
  if (!sb) return html`<div class="demo loading">Загружаем расчётный движок…</div>`;
  const run = a => { try { engine.act(sb.state, a); setErr(''); } catch (e) { setErr(e.message); } setRev(r => r + 1); };
  const data = engine.snapshot(sb.state);
  const late = data.trains.filter(t => t.delay > 0);
  const pax = data.trains.filter(t => t.category === 'passenger' && t.delay > 0);
  const d = data.dispatch;
  return html`<div class="demo sandbox">
    <div class="sandbox-bar">
      <div class="btn-row">
        ${data.blocked ? html`<${Button} icon="undo-2" onClick=${() => run({ type: 'block' })}>Снять закрытие</${Button}>` : html`<${Button} variant="danger-outline" icon="siren" onClick=${() => run({ type: 'block' })}>Закрыть перегон D–E</${Button}>`}
        <label>Скорость<select aria-label="Перегон" value=${segment} onChange=${e => setSegment(e.target.value)}>${data.stations.slice(0, -1).map((s, i) => html`<option key=${i} value=${i}>${s.id}–${data.stations[i + 1].id}</option>`)}</select></label>
        <label><span class="sr-only">км/ч</span><select aria-label="Скорость, км/ч" value=${kmh} onChange=${e => setKmh(e.target.value)}>${[25, 40, 60].map(v => html`<option key=${v} value=${v}>${v} км/ч</option>`)}</select></label>
        <${Button} icon="gauge" onClick=${() => run({ type: 'restrict', segment: Number(segment), kmh: Number(kmh) })}>Ограничить</${Button}>
        ${data.restrictions.length > 0 && html`<${Button} variant="ghost" icon="x" onClick=${() => data.restrictions.forEach(r => run({ type: 'unrestrict', segment: r.segment }))}>Снять ограничения</${Button}>`}
        <${Button} variant="ghost" icon="rotate-ccw" onClick=${() => { sb.state = engine.createState(); setErr(''); setRev(r => r + 1); }}>Сбросить</${Button}>
      </div>
      ${data.blocked && html`<div class="btn-row"><${Segmented} label="Вариант пропуска" value=${d.selected} onChange=${v => run({ type: 'variant', variantId: v })}
          options=${d.variants.map(v => ({ value: v.id, label: v.name + (v.recommended ? ' ★' : '') }))} />
        ${!data.planApproved && html`<${Button} variant="primary" icon="check" onClick=${() => run({ type: 'approve' })}>Подтвердить</${Button}>`}</div>`}
    </div>
    ${err && html`<p class="sb-err" role="alert">${err}</p>`}
    <div class="sandbox-kpis">
      <span><strong>${d.conflicts.length}</strong> конфликтов</span>
      <span><strong class=${pax.length ? 'bad' : ''}>${pax.length ? '+' + Math.max(...pax.map(t => t.delay)) : 0} мин</strong> худшее опоздание пассажирского</span>
      <span><strong>${late.length}</strong> поездов задержано</span>
      <span><strong>${data.notifications.length}</strong> уведомлений пассажирам</span>
    </div>
    <${Gantt} data=${data} zoom=${8} start=${0} compact />
    <p class="muted sb-note"><${Icon} name="info" size=${14} /> Песочница считает на ваших действиях тем же движком, что и рабочий экран, но не влияет на общую смену.</p>
  </div>`;
}

// ---------------------------------------------------------------- случаи

const CASES = [
  { id: 'derail', icon: 'siren', title: 'Сход на перегоне' },
  { id: 'window', icon: 'construction', title: 'Окно и ограничение скорости' },
  { id: 'priority', icon: 'users', title: 'Пассажирский против сборного' },
];

function Flow({ items }) {
  return html`<ol class="flow">${items.map((it, k) => html`<li key=${k} style=${`--i:${k}`}><span class="flow-icon"><${Icon} name=${it.icon} size=${20} /></span>
    <div><small>${it.label}</small><strong>${it.title}</strong><p>${it.text}</p></div></li>`)}</ol>`;
}

export function Cases() {
  const engine = useEngine();
  const [id, setId] = useState('derail');
  const r = useMemo(() => {
    if (!engine) return null;
    const blocked = snap(engine, [{ type: 'block' }]);
    const pax = d => Math.max(0, ...d.trains.filter(t => t.category === 'passenger').map(t => t.delay));
    const withSpeed = k => snap(engine, [{ type: 'restrict', segment: 5, kmh: k }]);
    const t153 = d => d.trains.find(t => t.number === '153');
    const byVar = id => snap(engine, [{ type: 'block' }, { type: 'variant', variantId: id }]);
    return { blocked, pax, s25: withSpeed(25), s40: withSpeed(40), n: snap(engine), t153, prio: byVar('priority'), fifo: byVar('fifo'), batch: byVar('batch') };
  }, [engine]);
  if (!r) return html`<div class="demo loading">Считаем примеры…</div>`;
  const rec = r.blocked.dispatch.variants.find(v => v.recommended);
  const d25 = r.t153(r.s25).delay, d40 = r.t153(r.s40).delay;
  const view = {
    derail: html`<${Flow} items=${[
      { icon: 'siren', label: 'Ситуация', title: 'Закрыт нечётный путь D–E', text: 'Сошёл грузовой, диспетчер закрыл путь. Участок останавливать нельзя.' },
      { icon: 'eye', label: 'Видит система', title: count(r.blocked.dispatch.conflicts.length, ['конфликт', 'конфликта', 'конфликтов']), text: 'Встречные поезда оказываются на единственном свободном пути одновременно.' },
      { icon: 'split', label: 'Решает система', title: `Рекомендует «${rec.name}»`, text: r.blocked.dispatch.why },
      { icon: 'bell-ring', label: 'Результат', title: `Пассажирские +${rec.metrics.passenger} мин`, text: 'После подтверждения пассажиры получают новое время прибытия.' }]} />`,
    window: html`<${Flow} items=${[
      { icon: 'construction', label: 'Ситуация', title: 'Ремонт пути закончен', text: 'Первый поезд проходит перегон на 25 км/ч, следующие на 40 км/ч, потом ограничение снимают.' },
      { icon: 'gauge', label: 'Видит система', title: 'Время хода растёт', text: `Для №153 на перегоне F–G: ограничение 25 км/ч даёт ${delayText(d25)}, 40 км/ч — ${delayText(d40)}.` },
      { icon: 'trending-down', label: 'Решает система', title: 'Пересчитывает прогноз', text: 'Каждый поезд, который идёт через перегон, получает новое время прибытия автоматически.' },
      { icon: 'bell-ring', label: 'Результат', title: 'Пассажиры предупреждены', text: 'Опоздание от 5 минут отправляется в пассажирские системы без участия диспетчера.' }]} />
      <div class="speed-bars" role="img" aria-label="Сравнение времени хода при разных ограничениях">${[['Без ограничения', 0, 'b-ink'], ['40 км/ч', d40, 'b-ink'], ['25 км/ч', d25, 'b-acc']].map(([l, v]) => html`<div class="sp-row" key=${l}><span>${l}</span><div class="score-bar"><i style=${`width:${Math.max(3, (v / Math.max(d25, 1)) * 100)}%`}></i></div><strong class="num">${delayText(v)}</strong></div>`)}</div>`,
    priority: html`<${Flow} items=${[
      { icon: 'users', label: 'Ситуация', title: 'Пассажирский и сборный встречаются', text: 'На одном пути оба не поместятся: кто-то должен ждать.' },
      { icon: 'scale', label: 'Видит система', title: 'Приоритет 1 против 3', text: 'Пассажирский весит в 10 раз больше, чем сборный.' },
      { icon: 'hand', label: 'Решает система', title: 'Сборный ждёт на станции', text: 'Но не дольше 45 минут, чтобы грузовые не стояли бесконечно.' },
      { icon: 'trending-up', label: 'Результат', title: `Пассажирские: +${r.prio.dispatch.metrics.passenger} мин против +${r.fifo.dispatch.metrics.passenger} мин`, text: 'Столько теряют пассажиры по приоритету и при простой очерёдности. Цена — задержка грузовых.' }]} />`,
  }[id];
  return html`<div class="demo cases"><${Tabs} label="Случаи" idPrefix="case" value=${id} onChange=${setId} tabs=${CASES.map(c => ({ value: c.id, label: c.title }))} />
    <div id="case-panel" role="tabpanel" aria-labelledby=${`case-${id}`} class="case-panel" key=${id}>${view}</div></div>`;
}

// ---------------------------------------------------------------- станции и вагоны

const LIFE = [
  { title: 'Принять', text: 'Группа вагонов резервирует места на подходящем по специализации пути.', cls: 'reserved' },
  { title: 'Обработать', text: 'Вагоны на грузовом фронте: идёт погрузка или выгрузка.', cls: 'processing' },
  { title: 'Обработано', text: 'Операции закончены, но путь ещё занят вагонами.', cls: 'done' },
  { title: 'Убрать', text: 'Вагоны убраны — только теперь путь свободен для следующей группы.', cls: 'clear' },
];

export function StationLifecycle() {
  const pl = usePlayer(LIFE.length, 3600);
  const cls = LIFE[pl.i].cls;
  const [moyynty, setMoyynty] = useState(1);
  const [karaganda, setKaraganda] = useState(4);
  const slack = days => Math.round(days * 24 * 60 - 180 - 30);
  const first = slack(moyynty) <= slack(karaganda) ? 'Мойынты' : 'Караганда';
  return html`<div class="demo station-demo">
    <div class="life">
      <div class="track-viz" role="img" aria-label=${`Путь станции: ${LIFE[pl.i].title}`}>
        ${Array.from({ length: 10 }, (_, k) => html`<span key=${k} class=${`cell ${cls}`} style=${`--d:${k * 60}ms`}></span>`)}</div>
      <div class="demo-caption" aria-live="polite"><span class="step-no">${pl.i + 1} / ${LIFE.length}</span><div><h3>${LIFE[pl.i].title}</h3><p>${LIFE[pl.i].text}</p></div></div>
      <${PlayerControls} player=${pl} length=${LIFE.length} labels=${LIFE.map(l => l.title)} />
    </div>
    <div class="queue">
      <h3>Кого принимать первым?</h3>
      <p class="muted">Две группы идут на одну станцию. Двигайте ползунки: первой выбирается та, у которой меньше запас до конца срока доставки.</p>
      ${[['Мойынты', moyynty, setMoyynty], ['Караганда', karaganda, setKaraganda]].map(([n, v, set]) => html`<label class=${`q-row ${first === n ? 'win' : ''}`} key=${n}>
        <span class="q-name">${n}${first === n && html` <${Badge} tone="accent" icon="zap">первой</${Badge}>`}</span>
        <input type="range" min="1" max="6" step="0.5" value=${v} onInput=${e => set(Number(e.target.value))} aria-label=${`Остаток срока доставки: ${n}, суток`} />
        <span class="num">${v} сут · запас ${duration(slack(v))}</span></label>`)}
      <p class="formula">запас = срок − прибытие − обработка (3 ч) − уборка (30 мин)</p>
    </div>
  </div>`;
}
