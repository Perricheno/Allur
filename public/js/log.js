import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { html, Icon, time, dateShort } from './lib.js';
import { useLiveNow, clock } from './store.js';
import { PageHeader, Empty, Segmented, Button, Badge } from './ui.js';
import { useSim } from './network-data.js';
import { networkEvents } from './network-sim.js';
import { RouteSelect } from './network-lists.js';
import { useNetworkArchive } from './network-archive.js';
import { ExportButton } from './network-export.js';

const PAGE = 120;
export const KINDS = [{ value: 'all', label: 'Все' }, { value: 'send', label: 'Отправлено' }, { value: 'accept', label: 'Принято' }, { value: 'crew', label: 'Смена бригады' }, { value: 'yield', label: 'Пропуск' },
  { value: 'hold', label: 'Задержка' }, { value: 'repair', label: 'Неисправность' }, { value: 'resolved', label: 'Решено' }];
export const DECISION = {
  send: { label: 'Отправлен', icon: 'navigation', tone: 'accent' }, accept: { label: 'Принят', icon: 'check-check', tone: 'neutral' }, crew: { label: 'Смена бригады', icon: 'user-round', tone: 'ink' },
  yield: { label: 'Пропуск', icon: 'shuffle', tone: 'ink' }, hold: { label: 'Задержка', icon: 'octagon-alert', tone: 'danger' }, repair: { label: 'Неисправность', icon: 'wrench', tone: 'danger' },
  resolved: { label: 'Решено', icon: 'badge-check', tone: 'accent' },
};
const WINDOWS = [{ value: 0, label: 'Всё время' }, { value: 60, label: '1 час' }, { value: 180, label: '3 часа' }, { value: 360, label: '6 часов' }, { value: 720, label: '12 часов' }, { value: 1440, label: 'Сутки' }];

/** Живая лента решений и событий сети: фильтры по типу, участку, периоду. */
export function EventFeed({ onCount, initialKind = 'all', initialWindow = 0 }) {
  const [kind, setKind] = useState(initialKind);
  const [route, setRoute] = useState('all');
  const [query, setQuery] = useState('');
  const [windowMin, setWindowMin] = useState(initialWindow);
  const [limit, setLimit] = useState(PAGE);
  const sim = useSim();
  const archive = useNetworkArchive();
  const live = useLiveNow(20);
  const [frozen, setFrozen] = useState(null);
  const now = frozen ?? live;
  const slot = now;
  const initial = useRef(null);
  const immediate = useMemo(() => (sim && !sim.error ? networkEvents(sim, now, windowMin || 60) : []), [sim, slot, windowMin]);
  const net = useMemo(() => {
    const records = new Map(archive.events.map(e => [e.id, e]));
    for (const e of immediate) records.set(e.id, e);
    return [...records.values()].filter(e => e.at <= now && (!windowMin || e.at >= now - windowMin * 60000));
  }, [archive.events, immediate[0]?.id, immediate.length, windowMin, frozen, Math.floor(now / 1000)]);
  if (sim && !sim.error && initial.current === null) initial.current = now;
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return net
      .filter(e => (kind === 'all' || e.kind === kind) && (route === 'all' || e.routeId === route) && (!q || `${e.text} ${e.route || ''}`.toLowerCase().includes(q)))
      .sort((a, b) => b.at - a.at);
  }, [net, kind, route, query]);
  useEffect(() => { onCount?.(rows.length); }, [rows.length]);
  const reset = fn => v => { fn(v); setLimit(PAGE); };
  return html`
    <div class="toolbar">
      <span class="feed-status"><span class=${frozen === null && clock.running ? 'feed-dot live' : 'feed-dot'}></span>${frozen !== null ? 'Просмотр приостановлен' : clock.running ? 'События по времени модели' : 'Модель на паузе'}</span>
      <${Button} size="sm" icon=${frozen === null ? 'pause' : 'play'} onClick=${() => setFrozen(frozen === null ? live : null)}>${frozen === null ? 'Пауза ленты' : 'К прямому эфиру'}</${Button}>
      <${ExportButton} section="journal" />
      <label class="search"><${Icon} name="search" size=${16} /><span class="sr-only">Поиск по журналу</span>
        <input type="search" placeholder="Город, станция, номер поезда" value=${query} onInput=${e => reset(setQuery)(e.target.value)} /></label>
      <label class="filter-select"><span class="sr-only">Период</span><select value=${windowMin} onChange=${e => reset(setWindowMin)(Number(e.target.value))} aria-label="Период">
        ${WINDOWS.map(w => html`<option key=${w.value} value=${w.value}>За ${w.label.toLowerCase()}</option>`)}</select></label>
    </div>
    <div class="filter-row">
      <${Segmented} label="Тип решения" value=${kind} onChange=${reset(setKind)} options=${KINDS} />
      <${RouteSelect} sim=${sim} value=${route} onChange=${reset(setRoute)} />
    </div>
    <p class="muted">${archive.startedAt ? `Архив с ${dateShort(archive.startedAt)} ${time(archive.startedAt)}. ` : 'Загрузка архива. '}Пауза ленты не останавливает движение.${archive.failed ? ' Связь с архивом потеряна, переподключаемся. Новые события рассчитываются локально.' : ''}</p>
    ${sim?.error ? html`<${Empty} icon="circle-alert" title="Маршруты не загрузились">Обновите страницу.</${Empty}>` : !sim ? html`<p class="muted">Загрузка событий…</p>` : rows.length ? html`<ol class="timeline live-timeline">${rows.slice(0, limit).map(e => html`<li key=${e.id} class=${e.at > initial.current && now - e.at < 3000 ? 'event-new' : ''}><time>${time(e.at)}:${String(new Date(e.at).getUTCSeconds()).padStart(2, '0')}<small>${dateShort(e.at)}</small></time>
      <div><p><${Badge} tone=${DECISION[e.kind].tone} icon=${DECISION[e.kind].icon}>${DECISION[e.kind].label}</${Badge}> ${e.text}${e.route ? html` <small class="muted">· ${e.route}</small>` : ''}</p>
      <details class="event-explanation"><summary>Почему и какой эффект</summary><p>${e.explanation || e.text}</p>
        <p>Поезд №${e.number} · ${e.station} · ${e.label}. ${e.dwell != null ? `Интервал операции: ${e.dwell} мин.` : ''}</p>
        ${e.calculation ? html`<p>${e.calculation}</p><p>Расчётная экономия: ${e.savedMin} мин; положительный взвешенный эффект: ${e.savedWeighted} мин.</p>` : html`<p>Для этой операции отдельное сравнение экономии не рассчитывается.</p>`}
        <small>Рейс ${e.uid} · запись ${e.id}</small>
      </details></div></li>`)}</ol>
      <div class="table-foot">Показано ${Math.min(limit, rows.length)} из ${rows.length.toLocaleString('ru-RU')} · события появляются по ходу модели
        ${rows.length > limit && html`<${Button} size="sm" onClick=${() => setLimit(limit + PAGE)}>Показать ещё</${Button}>`}</div>`
      : html`<${Empty} icon="search" title="Записей нет">Измените период или фильтры.</${Empty}>`}`;
}

export function LogPage() {
  const [total, setTotal] = useState(0);
  return html`<${PageHeader} title="Журнал" subtitle="В реальном времени: отправления, приёмы, смены бригад, пропуск поездов, задержки, неисправности и их решение по всей сети КТЖ" />
    <section class="panel">
      <div class="panel-head"><h2>События и решения</h2><${Badge} tone="neutral">${total.toLocaleString('ru-RU')} записей</${Badge}></div>
      <div class="tab-panel"><${EventFeed} onCount=${setTotal} /></div>
    </section>`;
}
