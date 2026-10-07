import { MapPage } from './geographic-map.js';
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { html, Icon, time, dateLong } from './lib.js';
import { app, useApp, connect, act, href, useLiveNow, clock } from './store.js';
import { Button, Dialog, Toasts } from './ui.js';
import { Overview, DecisionsPage, Trains, Stations } from './pages.js';
import { HowPage } from './how.js';
import { StationPage } from './station.js';
import { LogPage } from './log.js';
import { ModelPage } from './model.js';
import { StatsPage } from './stats.js';
import { EnginePage } from './engine-lab.js';
import { SchedulesPage } from './schedules.js';
import { FleetPage } from './fleet.js';
import { NetworkPage } from './network-map.js';
import { useNetworkTotals } from './network-data.js';
import { QuickSearch } from './search.js';
import { InstallApp } from './install-app.js';
import { DevelopersPage } from './developers.js';

const NAV = [
  { page: 'network', path: '/', label: 'Карта сети', icon: 'map-pin' },
  { page: 'trains', path: '/trains', label: 'Поезда', icon: 'train-front' },
  { page: 'stations', path: '/stations', label: 'Станции', icon: 'building-2', also: ['station'] },
  { page: 'model', path: '/model', label: 'Решения модели', icon: 'lightbulb' },
  { page: 'engine', path: '/engine', label: 'Модель', icon: 'cpu' },
  { page: 'stats', path: '/stats', label: 'Статистика', icon: 'trending-up' },
  { page: 'schedules', path: '/schedules', label: 'Расписания', icon: 'calendar-clock' },
  { page: 'log', path: '/log', label: 'Журнал', icon: 'list-checks' },
  { page: 'fleet', path: '/fleet', label: 'Парк и депо', icon: 'truck' },
  { page: 'overview', path: '/overview', label: 'Диспетчерская панель', icon: 'chart-gantt', also: ['decisions', 'map'] },
  { page: 'how', path: '/how', label: 'Как это работает', icon: 'book-open' },
  { page: 'developers', path: '/developers', label: 'Разработчикам', icon: 'activity' },
];
const TITLES = { developers: 'Разработчикам', schedules: 'Расписания', network: 'Карта сети', fleet: 'Парк и сеть', map: 'Карта участка', overview: 'Обстановка', decisions: 'Решения', model: 'Решения модели', engine: 'Модель', stats: 'Статистика', trains: 'Поезда', stations: 'Станции', station: 'Станция', log: 'Журнал', how: 'Как это работает' };

function Nav({ page, onAbout, attention, mini, onMini }) {
  const more = useRef(null);
  useEffect(() => { if (more.current) more.current.open = false; }, [page]);
  useEffect(() => {
    const close = e => { if (more.current && (!more.current.contains(e.target) || e.key === 'Escape')) more.current.open = false; };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, []);
  return html`<nav class="nav" aria-label="Основное меню">
    <a class="brand" href=${href('/')} aria-label="Автодиспетчер — на главную">
      <img src="/assets/ktz-emblem.png" alt="" width="40" height="40" />
      <span><strong>Автодиспетчер</strong><small>Поездной диспетчер · ГИД</small></span>
    </a>
    <ul>${NAV.map(n => html`<li key=${n.page}><a href=${href(n.path)} title=${n.label} class=${page === n.page || n.also?.includes(page) ? 'on' : ''}
      aria-current=${page === n.page || n.also?.includes(page) ? 'page' : undefined}><${Icon} name=${n.icon} size=${19} /><span>${n.label}</span>${n.page === 'overview' && attention > 0 && html`<b class="nav-badge" aria-label=${`Требует решения: ${attention}`}>${attention}</b>`}</a></li>`)}</ul>
    <details class="mobile-more" ref=${more}><summary><${Icon} name="menu" size=${19} /><span>Ещё</span></summary><div class="more-links">${NAV.slice(4).map(n => html`<a key=${n.page} href=${href(n.path)}><${Icon} name=${n.icon} size=${18} />${n.label}</a>`)}<button type="button" onClick=${() => { more.current.open = false; onAbout(); }}><${Icon} name="info" size=${18} />О системе</button></div></details>
    <div class="nav-foot">
      <img class="wordmark" src="/assets/ktz-wordmark.png" alt="Қазақстан темір жолы" />
      <button type="button" class="nav-link" onClick=${onAbout} title="О системе"><${Icon} name="info" size=${18} /><span>О системе</span></button>
      <button type="button" class="nav-link nav-collapse" onClick=${onMini} aria-pressed=${mini} title=${mini ? 'Развернуть меню' : 'Свернуть меню'}><${Icon} name=${mini ? 'chevron-right' : 'chevron-left'} size=${18} /><span>Свернуть меню</span></button>
    </div>
  </nav>`;
}

function Topbar({ data, onReset, onSearch }) {
  const dis = !app.online || app.busy;
  const liveMs = useLiveNow(1);
  const step = m => act({ type: 'advance', minutes: m });
  const totals = useNetworkTotals();
  return html`<header class="topbar">
    <button class="global-search" type="button" onClick=${onSearch} aria-label="Поиск поездов и станций"><${Icon} name="search" size=${17} /><span>Поезд или станция</span><kbd>⌘ / Ctrl K</kbd></button>
    <div class="clock" aria-label="Время модели">
      <${Icon} name="clock" size=${18} />
      <div><strong class="num">${time(liveMs)}</strong><small>${dateLong(liveMs)} · ${clock.running ? (clock.synced && data.speed === 1 ? 'реальное время' : `ускорено ×${data.speed}`) : 'на паузе'}</small></div>
    </div>
    ${totals && html`<a class="net-chip-top" href=${href('/')} title="Поездов на всей сети КТЖ сейчас"><${Icon} name="train-front" size=${16} /><span>Сеть: <strong class="num">${totals.total.toLocaleString('ru-RU')}</strong> поездов</span></a>`}
    <div class="btn-group" role="group" aria-label="Перемотать время вперёд">
      ${[[15, '+15 мин'], [30, '+30 мин'], [60, '+1 час']].map(([m, l]) => html`<${Button} key=${m} size="sm" variant="secondary" disabled=${dis} reason=${app.online ? 'Выполняется действие' : 'Нет соединения с сервером'} onClick=${() => step(m)}>${l}</${Button}>`)}
    </div>
    <span class=${`conn ${app.online ? 'ok' : 'off'}`} role="status"><${Icon} name=${app.online ? 'wifi' : 'wifi-off'} size=${16} />${app.online ? 'На связи' : 'Нет связи'}</span>
    <${Button} variant="ghost" size="sm" icon="rotate-ccw" label="Начать смену заново" title="Начать смену заново" onClick=${onReset} />
  </header>`;
}

function App() {
  useApp();
  const { data, route } = app;
  const [dialog, setDialog] = useState(null);
  useEffect(() => {
    const shortcut = e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setDialog(d => d === 'search' ? null : 'search'); } };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);
  const [mini, setMini] = useState(() => localStorage.getItem('navMini') === '1');
  const toggleMini = () => setMini(m => { localStorage.setItem('navMini', m ? '0' : '1'); return !m; });
  useEffect(() => { document.title = `${TITLES[route.page] || 'Автодиспетчер'} — Автодиспетчер КТЖ`; }, [route.page]);
  if (!data) {
    return html`<div class="boot" role="status">${app.failed ? html`<div class="boot-error"><h1>Не удалось подключиться к серверу</h1><p>Соединение восстановится автоматически. Если страница не оживает, перезапустите сервер.</p></div>` : 'Подключение к диспетчерской…'}</div>`;
  }
  const page = {
    network: html`<${NetworkPage} data=${data} />`,
    overview: html`<${Overview} data=${data} />`,
    decisions: html`<${DecisionsPage} data=${data} />`,
    model: html`<${ModelPage} data=${data} />`,
    stats: html`<${StatsPage} data=${data} />`,
    engine: html`<${EnginePage} />`,
    schedules: html`<${SchedulesPage} />`,
    developers: html`<${DevelopersPage} />`,
    how: html`<${HowPage} />`,
    trains: html`<${Trains} data=${data} />`,
    stations: html`<${Stations} data=${data} />`,
    map: html`<${MapPage} data=${data} />`,
    fleet: html`<${FleetPage} data=${data} />`,
    station: html`<${StationPage} data=${data} params=${route.params} />`,
    log: html`<${LogPage} data=${data} />`,
  }[route.page];
  return html`<div class=${`shell ${mini ? 'mini' : ''}`}>
    <${Nav} mini=${mini} onMini=${toggleMini} page=${route.page} onAbout=${() => setDialog('about')} attention=${data.blocked && !data.planApproved ? data.dispatch.conflicts.length : 0} />
    <div class="workspace">
      <${Topbar} data=${data} onReset=${() => setDialog('reset')} onSearch=${() => setDialog('search')} />
      ${!app.online && html`<div class="offline" role="alert"><${Icon} name="wifi-off" size=${18} /> Нет соединения с сервером. Действия временно недоступны — подключаемся заново…</div>`}
      <main id="main" tabindex="-1">${page}</main>
      <footer class="foot"><span>Помощник диспетчера. Решение принимает поездной диспетчер.</span><${InstallApp} /><span>Система не заменяет СЦБ и сертифицированные системы безопасности.</span></footer>
    </div>
    <${Toasts} />
    <${QuickSearch} data=${data} open=${dialog === 'search'} onClose=${() => setDialog(null)} />
    <${Dialog} id="reset" open=${dialog === 'reset'} onClose=${() => setDialog(null)} title="Начать смену заново?"
      actions=${html`<${Button} onClick=${() => setDialog(null)}>Отмена</${Button}><${Button} variant="danger" onClick=${async () => { setDialog(null); await act({ type: 'reset' }); }}>Сбросить смену</${Button}>`}>
      <p>Все операции, резервы, ограничения и события будут сброшены. Это общее состояние для всех, кто открыл систему.</p>
    </${Dialog}>
    <${Dialog} id="about" open=${dialog === 'about'} onClose=${() => setDialog(null)} title="О системе">
      <p>Автодиспетчер помогает поездному диспетчеру в нестандартных ситуациях: закрытие пути после схода, движение по неправильному пути, ограничения скорости после ремонта.</p>
      <p>Система находит конфликты встречных поездов, считает несколько вариантов пропуска с учётом приоритетов, предлагает лучший и пересчитывает прогноз после подтверждения. Об опоздании пассажирских поездов она сообщает пассажирам.</p>
      <p><strong>Границы.</strong> Все данные условные. Интервальное регулирование, стрелочные маршруты и сигналы не моделируются; решение остаётся за диспетчером.</p>
    </${Dialog}>
  </div>`;
}

connect();
render(html`<${App} />`, document.getElementById('root'));
