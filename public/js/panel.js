import { useEffect, useState } from 'preact/hooks';
import { html, Icon, clockAt, time, duration, delayText, count, PRIORITY, DIRECTION } from './lib.js';
import { app, act, go, href, updateUi, useLiveNow } from './store.js';
import { Button, Badge, Tabs, Empty, Segmented } from './ui.js';
import { placeTrains, describeTrain } from './trackmap.js';
import { Scenarios } from './decisions.js';

const HOLDS = [{ value: 5, label: '5' }, { value: 10, label: '10' }, { value: 20, label: '20' }, { value: 30, label: '30' }];
const pick = n => updateUi({ selectedTrain: app.ui.selectedTrain === n ? null : n });

/** Все задачи, требующие внимания диспетчера, по убыванию срочности. */
function buildTasks(data, nowMs) {
  const tMin = (nowMs - data.baseTime) / 60000;
  const tasks = [];
  const d = data.dispatch;
  if (data.blocked && !data.planApproved) {
    const sel = d.variants.find(v => v.id === d.selected);
    tasks.push({ id: 'approve', tone: 'danger', icon: 'siren', title: 'Подтвердите вариант пропуска',
      text: `${count(d.closures.length, ['закрытие пути', 'закрытия пути', 'закрытий пути'])}, ${count(d.conflicts.length, ['конфликт', 'конфликта', 'конфликтов'])}. Выбран «${sel.name}»${sel.recommended ? ' (рекомендован)' : ''}: пассажирские +${sel.metrics.passenger} мин, всего +${sel.metrics.total} мин.${data.auto.approve ? ' Автопилот применит рекомендацию через 15 минут.' : ''}`,
      actions: [{ label: 'Подтвердить', icon: 'check', variant: 'primary', run: () => act({ type: 'approve' }) }, { label: 'Варианты', icon: 'split', run: () => go('/decisions') }] });
  }
  for (const t of data.trains.filter(t => t.broken && tMin >= t.broken.from)) {
    const inc = data.incidents.find(i => i.id === t.broken.id);
    tasks.push({ id: `bd${t.number}`, tone: 'danger', icon: 'ambulance', title: t.broken.label,
      text: `${data.breakdownLevels[t.broken.level].text}${t.broken.until != null ? ` Устранение до ${clockAt(data, t.broken.until)}.` : ''}`,
      actions: [...(t.broken.level >= 2 && inc ? [{ label: 'Устранить досрочно', icon: 'zap', run: () => act({ type: 'reopen', id: inc.id }) }] : []), { label: 'Показать', icon: 'eye', variant: 'ghost', run: () => pick(t.number) }] });
  }
  for (const c of d.closures.filter(c => c.from > tMin && c.from - tMin <= 60 && !c.train)) {
    tasks.push({ id: `win${c.id}`, tone: 'accent', icon: 'construction', title: `Через ${Math.round(c.from - tMin)} мин: ${c.label.toLowerCase()}`,
      text: `Перегон ${data.stations[c.segment].id}–${data.stations[c.segment + 1].id}, ${{ odd: 'нечётный путь', even: 'чётный путь', both: 'оба пути' }[c.track]} до ${c.until == null ? 'отмены' : clockAt(data, c.until)}.`, info: true,
      actions: [{ label: 'Решения', icon: 'scale', variant: 'ghost', run: () => go('/decisions') }] });
  }
  const stopped = placeTrains(data, tMin).filter(r => r.stopped && !r.broken).sort((a, b) => b.waitedMin - a.waitedMin);
  for (const r of stopped) {
    const t = r.t;
    const acts = [{ label: 'Показать', icon: 'eye', variant: 'ghost', run: () => pick(t.number) }];
    if (r.held) acts.unshift({ label: 'Отпустить', icon: 'play', run: () => act({ type: 'release', train: t.number }) });
    else if (!t.overridden && t.basePriority > 1) acts.unshift({ label: 'Пропустить первым', icon: 'zap', run: () => act({ type: 'expedite', train: t.number }) });
    tasks.push({ id: `stop${t.number}`, tone: 'danger', icon: 'hourglass', title: `№${t.number} стоит на «${data.stations[r.loc.idx].name}» ${r.waitedMin} мин`,
      text: `${t.label}: ${r.reason}.${r.restMin != null ? ` Отправление по плану через ${r.restMin} мин.` : ''}`, actions: acts });
  }
  for (const g of data.groups.filter(g => g.status === 'approaching' && g.etaAt <= nowMs)) {
    tasks.push({ id: `grp${g.id}`, tone: 'accent', icon: 'package', title: `Вагоны прибыли на «${data.stations.find(s => s.id === g.stationId).name}»: №${g.train}`,
      text: `${data.cargoNames[g.cargo]}, ${g.count} ваг. · остаток срока ${duration((g.deadlineAt - nowMs) / 60000)}${g.eligible ? '' : ` · ${g.reason}`}`,
      actions: [{ label: 'Принять', icon: 'check', variant: 'primary', disabled: !g.eligible, reason: g.reason, run: () => act({ type: 'accept', groupId: g.id }) },
        { label: 'Станция', icon: 'building-2', variant: 'ghost', run: () => updateUi({ selectedStation: g.stationId }) }] });
  }
  for (const g of data.groups.filter(g => g.status !== 'arrived' && g.slackMinutes < 0).slice(0, 4)) {
    tasks.push({ id: `risk${g.id}`, tone: 'danger', icon: 'calendar-clock', title: `Риск просрочки доставки: №${g.train}`,
      text: `${data.cargoNames[g.cargo]}, ${g.count} ваг. на «${data.stations.find(s => s.id === g.stationId).name}»: запас ${duration(g.slackMinutes)}.`,
      actions: [{ label: 'Станция', icon: 'building-2', run: () => updateUi({ selectedStation: g.stationId }) }] });
  }
  for (const t of data.trains.filter(t => t.category === 'passenger' && t.delay >= 5).sort((a, b) => b.delay - a.delay).slice(0, 3)) {
    tasks.push({ id: `pax${t.number}`, tone: 'neutral', icon: 'bell-ring', title: `Пассажирский №${t.number} опаздывает на ${t.delay} мин`,
      text: 'Пассажиры уведомлены автоматически о новом времени прибытия.', info: true, actions: [{ label: 'Показать', icon: 'eye', variant: 'ghost', run: () => pick(t.number) }] });
  }
  return tasks;
}

function Task({ t }) {
  return html`<li class=${`task task-${t.tone}`}>
    <span class="task-icon"><${Icon} name=${t.icon} size=${18} /></span>
    <div class="task-body"><strong>${t.title}</strong><p>${t.text}</p>
      <div class="btn-row">${t.actions.map(a => html`<${Button} key=${a.label} size="sm" variant=${a.variant || 'secondary'} icon=${a.icon} disabled=${a.disabled} reason=${a.reason} onClick=${a.run}>${a.label}</${Button}>`)}</div></div>
  </li>`;
}

const LEVELS = [1, 2, 3, 4];
const Fact = ({ icon, label, value, bad }) => html`<div class=${`fact ${bad ? 'bad' : ''}`}><${Icon} name=${icon} size=${16} /><span>${label}</span><strong>${value}</strong></div>`;

function TrainTab({ data, nowMs }) {
  const [mins, setMins] = useState(10);
  const [level, setLevel] = useState(2);
  const [kind, setKind] = useState('');
  const n = app.ui.selectedTrain;
  const t = n && data.trains.find(x => x.number === n);
  if (!t) return html`<${Empty} icon="mouse-pointer-click" title="Выберите поезд">Нажмите на поезд на схеме или в списке задач. Здесь появятся его характеристики, ТО и команды: задержать, пропустить первым, спроецировать поломку.</${Empty}>`;
  const tMin = (nowMs - data.baseTime) / 60000;
  const rec = placeTrains(data, tMin).find(r => r.t.number === n);
  const holds = data.holds.filter(h => h.train === n);
  const done = tMin > t.forecast.at(-1)[0] + 8 && !t.disabled;
  const noStop = tMin >= t.forecast.at(-1)[0];
  const ts = t.techState;
  const types = Object.entries(data.breakdownTypes).filter(([, v]) => v.levels.includes(level));
  const kindOk = types.some(([k]) => k === kind) ? kind : types[0]?.[0];
  const onLineNow = Boolean(rec) && !rec.service;
  return html`<div class="train-ctl">
    <div class="tc-head"><strong class="tc-num">№${t.number}</strong><${Badge} tone=${PRIORITY[t.priority].tone}>${t.label}</${Badge}>
      ${t.overridden && html`<${Badge} tone="accent" icon="zap">пропускается первым</${Badge}>`}
      ${t.broken && html`<${Badge} tone="danger" icon="ambulance">${data.breakdownLevels[t.broken.level].name} поломка</${Badge}>`}
      <${Badge} tone=${t.delay > 0 || t.disabled ? 'danger' : 'neutral'}>${t.disabled ? 'снят с рейса' : delayText(t.delay)}</${Badge}></div>
    <p class="tc-status">${rec ? describeTrain(data, rec, tMin) : done ? 'Поезд прибыл и ушёл с линии.' : `Ещё не вышел: отправление в ${clockAt(data, t.forecast[0][0])} со станции «${data.stations[Math.round(t.forecast[0][1])].name}».`}</p>
    <div class="facts" aria-label="Характеристики поезда">
      <${Fact} icon="truck" label="Локомотив" value=${`${t.loco.series} №${t.loco.number}`} />
      <${Fact} icon="zap" label="Мощность" value=${`${t.loco.powerKw} кВт, ${t.loco.type}`} />
      <${Fact} icon="package" label=${t.category === 'passenger' ? 'Заполнение' : 'Загрузка'} value=${`${t.loadPct}%${t.cargo ? ` · ${data.cargoNames[t.cargo].toLowerCase()}` : ''}`} />
      <${Fact} icon="weight" label="Масса брутто" value=${`${t.grossT} т`} />
      <${Fact} icon="ruler" label="Длина / вагонов" value=${`${t.lengthM} м / ${t.wagons}`} />
      <${Fact} icon="gauge" label="Скорость ср. / макс." value=${`${t.avgKmh} / ${t.maxKmh} км/ч`} />
      <${Fact} icon="activity" label="Осевая нагрузка" value=${`${t.axleLoadT} т`} />
      <${Fact} icon="user-round" label="Бригада за рулём" value=${`${ts.crewOnDutyH} ч, отдых через ${ts.crewRestInH} ч`} bad=${ts.crewRestInH < 1.5} />
      <${Fact} icon="wrench" label="Техобслуживание" value=${`${ts.status} · с ТО ${ts.hoursSince} ч из ${t.tech.intervalH}`} bad=${ts.status === 'скоро ТО'} />
      <${Fact} icon="heart-pulse" label="Тех. состояние" value=${`${ts.conditionPct}%`} bad=${ts.conditionPct < 55} />
      ${ts.fuelPct !== null && html`<${Fact} icon="fuel" label="Топливо" value=${`${ts.fuelPct}%`} bad=${ts.fuelPct < 25} />`}
      <${Fact} icon="route" label="Маршрут" value=${`${data.stations[t.route[0][1]].name} → ${data.stations[t.route.at(-1)[1]].name}`} />
    </div>
    <div class="tc-block"><h3>Задержать на ближайшей станции</h3>
      <div class="btn-row"><${Segmented} label="Минут" value=${mins} options=${HOLDS} onChange=${setMins} />
        <${Button} icon="hourglass" disabled=${done || noStop || t.disabled} reason=${done ? 'Поезд уже прибыл' : t.disabled ? 'Поезд снят с рейса' : 'Дальше только конечная станция'} onClick=${() => act({ type: 'hold', train: n, minutes: mins })}>Задержать на ${mins} мин</${Button}></div>
      ${holds.length > 0 && html`<ul class="holds">${holds.map(h => html`<li key=${h.station}><${Icon} name="hourglass" size=${15} /><span>«${data.stations[h.station].name}» · ${h.minutes} мин</span></li>`)}
        <li><${Button} size="sm" variant="ghost" icon="x" onClick=${() => act({ type: 'release', train: n })}>Снять задержки</${Button}></li></ul>`}</div>
    <div class="tc-block"><h3>Очерёдность на перегонах</h3>
      ${t.overridden
        ? html`<${Button} icon="undo-2" onClick=${() => act({ type: 'restore', train: n })}>Вернуть исходный приоритет</${Button}>`
        : html`<${Button} icon="zap" disabled=${t.basePriority === 1 || done || t.disabled} reason=${t.basePriority === 1 ? 'Пассажирский уже идёт первым' : 'Поезд не на линии'} onClick=${() => act({ type: 'expedite', train: n })}>Пропустить первым</${Button}>`}
      <small>Повышает приоритет до пассажирского: при конфликте на закрытом перегоне поезд пойдёт раньше, остальные подождут.</small></div>
    <div class="tc-block breakdown"><h3>Спроецировать поломку</h3>
      <div class="levels" role="radiogroup" aria-label="Уровень поломки">${LEVELS.map(l => html`<button type="button" role="radio" aria-checked=${level === l} key=${l} class=${`level l${l} ${level === l ? 'on' : ''}`} onClick=${() => setLevel(l)}>
        <strong>${l}. ${data.breakdownLevels[l].name}</strong><small>${data.breakdownLevels[l].short}</small></button>`)}</div>
      <p class="muted">${data.breakdownLevels[level].text}</p>
      <div class="field-row"><label>Неисправность
        <select value=${kindOk} onChange=${e => setKind(e.target.value)} aria-label="Вид неисправности">${types.map(([k, v]) => html`<option key=${k} value=${k}>${v.name}</option>`)}</select></label>
        <${Button} variant="danger-outline" icon="ambulance" disabled=${!onLineNow || Boolean(t.broken)} reason=${t.broken ? 'С этим поездом уже случилась поломка' : 'Поезд сейчас не на линии'}
          onClick=${() => act({ type: 'breakdown', train: n, level, kind: kindOk })}>Спроецировать</${Button}></div></div>
  </div>`;
}

function StationTab({ data, nowMs }) {
  const s = data.stations.find(x => x.id === app.ui.selectedStation);
  if (!s) return html`<${Empty} icon="building-2" title="Выберите станцию">Нажмите на станцию на схеме, чтобы увидеть подъездные пути, вагоны и группы, ожидающие приёма.</${Empty}>`;
  const groups = data.groups.filter(g => g.stationId === s.id && g.status !== 'arrived');
  return html`<div class="train-ctl">
    <div class="tc-head"><strong class="tc-num">${s.name}</strong><${Badge}>${s.type}</${Badge}><${Badge} tone="accent">${s.occupied} / ${s.capacity} ваг.</${Badge}></div>
    <ul class="st-tracks">${s.tracks.map(t => html`<li key=${t.id}><span class="st-name">${t.number}. ${t.name}<small>${data.cargoNames[t.cargo]}</small></span>
      <div class="occ-bar" role="img" aria-label=${`Занято ${t.occupied} из ${t.capacity}`}><i class="seg processing" style=${`width:${t.processing / t.capacity * 100}%`}></i><i class="seg done" style=${`width:${t.done / t.capacity * 100}%`}></i><i class="seg waiting" style=${`width:${t.waiting / t.capacity * 100}%`}></i><i class="seg reserved" style=${`width:${t.reserved / t.capacity * 100}%`}></i></div>
      <span class="num">${t.occupied}/${t.capacity}</span>
      <div class="btn-row"><${Button} size="sm" icon="check" disabled=${!t.processing} reason="Нет вагонов под грузовыми операциями" onClick=${() => act({ type: 'complete', trackId: t.id })}>Завершить</${Button}>
        <${Button} size="sm" icon="package" disabled=${!t.done} reason="Нет обработанных вагонов" onClick=${() => act({ type: 'clear', trackId: t.id })}>Убрать${t.done ? ` ${t.done}` : ''}</${Button}></div></li>`)}</ul>
    <div class="tc-block"><h3>Группы вагонов</h3>
      ${groups.length ? html`<ul class="holds big">${groups.map(g => {
        const here = g.etaAt <= nowMs;
        return html`<li key=${g.id}><span><strong>№${g.train}</strong> · ${data.cargoNames[g.cargo]}, ${g.count} ваг. · ${here ? 'прибыла' : `прибудет в ${time(g.etaAt)}`}${g.status === 'reserved' ? ' · в резерве' : ''}</span>
          <${Button} size="sm" variant=${here && g.eligible ? 'primary' : 'secondary'} icon="check" disabled=${!here || !g.eligible || g.status === 'reserved'}
            reason=${!here ? `Ещё в пути, прибытие в ${time(g.etaAt)}` : g.status === 'reserved' ? 'Уже в резерве: примите на странице станции' : g.reason} onClick=${() => act({ type: 'accept', groupId: g.id })}>Принять</${Button}></li>`;
      })}</ul>` : html`<p class="muted">Групп на подходе нет.</p>`}</div>
    <a class="link" href=${href(`/station/${s.id}`)}>Открыть страницу станции →</a>
  </div>`;
}

export function DispatcherPanel({ data }) {
  const nowMs = useLiveNow(1);
  const [tab, setTab] = useState('train');
  const tasks = buildTasks(data, nowMs);
  const urgent = tasks.filter(t => !t.info).length;
  useEffect(() => { if (app.ui.selectedTrain) setTab('train'); }, [app.ui.selectedTrain]);
  useEffect(() => { if (app.ui.selectedStation) setTab('station'); }, [app.ui.selectedStation]);
  return html`<section class="panel dispatcher" aria-labelledby="dsp-title">
    <div class="panel-head"><div><h2 id="dsp-title">Панель диспетчера</h2><small>Что требует решения, команды по поезду и станции</small></div>
      <${Badge} tone=${urgent ? 'danger' : 'neutral'} icon=${urgent ? 'siren' : 'circle-check'}>${urgent ? count(urgent, ['задача', 'задачи', 'задач']) : 'Всё по графику'}</${Badge}></div>
    <div class="dsp-grid">
      <div class="dsp-tasks"><h3>Задачи</h3>
        ${tasks.length ? html`<ul class="tasks">${tasks.map(t => html`<${Task} key=${t.id} t=${t} />`)}</ul>`
          : html`<${Empty} icon="circle-check" title="Задач нет">Движение идёт по графику. Введите событие справа или откройте «Как это работает».</${Empty}>`}</div>
      <div class="dsp-tabs"><${Tabs} label="Команды" idPrefix="dsp" value=${tab} onChange=${setTab}
          tabs=${[{ value: 'train', label: 'Поезд' }, { value: 'station', label: 'Станция' }, { value: 'events', label: 'События' }]} />
        <div id="dsp-panel" role="tabpanel" aria-labelledby=${`dsp-${tab}`} class="tab-panel">
          ${tab === 'train' ? html`<${TrainTab} data=${data} nowMs=${nowMs} />` : tab === 'station' ? html`<${StationTab} data=${data} nowMs=${nowMs} />` : html`<${Scenarios} data=${data} bare />`}
        </div></div>
    </div>
  </section>`;
}
