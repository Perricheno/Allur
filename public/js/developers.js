import { useEffect, useRef, useState } from 'preact/hooks';
import { html } from './lib.js';
import { Button, Kpi, PageHeader } from './ui.js';

const num = n => n == null ? '—' : Number(n.toFixed(2)).toLocaleString('ru-RU');
const mb = n => `${num(n / 1048576)} МБ`;
const names = { networkSnapshots: 'Снимки всей сети', eventWindows: 'Расчёты окон событий', profilesBuilt: 'Построенные профили рейсов', profileCacheHits: 'Попадания в кэш профилей', allocationRuns: 'Запуски распределения тяги', tripAssignments: 'Рассмотренные заявки на рейс', compatibilityInspections: 'Проверки совместимости локомотивов' };
function Chart({ history, field, title, unit }) {
  const max = Math.max(1, ...history.map(p => p[field] || 0));
  const points = history.map((p, i) => `${i / Math.max(1, history.length - 1) * 600},${90 - (p[field] || 0) / max * 80}`).join(' ');
  return html`<section class="panel developer-chart"><h3>${title}</h3><small>Пик окна ${num(max)} ${unit} · до 120 секунд</small><svg viewBox="0 0 600 100" role="img" aria-label=${title}><line x1="0" x2="600" y1="90" y2="90" stroke="var(--line)"/><polyline points=${points} fill="none" stroke="var(--accent)" stroke-width="2"/></svg></section>`;
}
export function DevelopersPage() {
  const [data, setData] = useState(null), [online, setOnline] = useState(false), [paused, setPaused] = useState(false);
  const pause = useRef(false), latest = useRef(null);
  useEffect(() => {
    const stream = new EventSource('/api/developer-events');
    stream.addEventListener('telemetry', event => { const next = JSON.parse(event.data); latest.current = next; setOnline(true); if (!pause.current) setData(next); });
    stream.onerror = () => setOnline(false);
    return () => stream.close();
  }, []);
  const toggle = () => { pause.current = !pause.current; setPaused(pause.current); if (!pause.current && latest.current) setData(latest.current); };
  const exportData = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'ktz-diagnostics.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  if (!data) return html`<${PageHeader} title="Разработчикам" subtitle="Измерения сервера в реальном времени" /><p role="status">${online ? 'Получаем измерения…' : 'Подключение к диагностике…'}</p>`;
  const cards = [
    ['Процессы в контейнере', data.processes, '', 'Видимые PID, не все процессы хост-сервера'],
    ['Потоки процесса Node.js', data.threads, '', 'Главный поток и служебные потоки среды'],
    ['CPU приложения', data.cpuPct, '%', '100% соответствует одному ядру'],
    ['Память RSS', data.memory.rss / 1048576, 'МБ', 'Резидентная память процесса'],
    ['Куча JavaScript', data.memory.heapUsed / 1048576, 'МБ', `Выделено ${mb(data.memory.heapTotal)}`],
    ['Внешняя память', data.memory.external / 1048576, 'МБ', `ArrayBuffer ${mb(data.memory.arrayBuffers)}`],
    ['Задержка event loop P95', data.loop.p95Ms, 'мс', `Максимум ${num(data.loop.maxMs)} мс`],
    ['Запись данных', data.rates.writeBytes / 1024, 'КБ/с', 'Успешные записи состояния, плана и журнала'],
    ['Новые записи журнала', data.rates.records, '/с', 'Новые события, не перезаписанные JSON-поля'],
    ['Всего событий архива', data.archive.records, '', `${num(data.archive.records / 1000000)} млн · ${data.archive.persisted ? 'архив на диске' : 'тестовый архив в памяти'}`],
    ['HTTP-запросы', data.rates.requests, '/с', `Всего с запуска ${num(data.http.requests)}`],
    ['Исходящие данные', data.rates.sentBytes / 1024, 'КБ/с', 'Тела HTTP/SSE, без накладных расходов TLS'],
    ['Логические операции', data.rates.computations, '/с', 'Сумма инструментированных счётчиков ниже; не FLOPS'],
    ['Открытые дескрипторы', data.descriptors, '', 'Файлы и сокеты процесса'],
    ['Время работы', data.uptimeSec / 3600, 'ч', 'Процесс приложения с последнего старта'],
    ['HTTP-ошибки', data.http.errors, '', 'Ответы с кодом 400 и выше'],
  ];
  return html`<${PageHeader} title="Разработчикам" subtitle="Живая диагностика приложения: процессы, расчёты, данные и доставка событий" actions=${html`<${Button} onClick=${toggle} icon=${paused ? 'play' : 'pause'}>${paused ? 'Продолжить' : 'Пауза показаний'}</${Button}><${Button} icon="download" onClick=${exportData}>Диагностика · JSON</${Button}>`} />
    <p role="status" class=${online ? '' : 'bad'}>${online ? paused ? 'Показания на паузе; модель продолжает работать.' : 'Подключено · сервер передаёт измерения каждую секунду.' : 'Связь потеряна. Показан последний снимок; переподключаемся.'} Снимок ${new Date(data.at).toLocaleTimeString('ru-RU')}.</p>
    ${data.archive.through > data.model.now + 1000 && html`<p class="panel panel-head">Архив содержит уже пройденный на ускорении период — на ${Math.ceil((data.archive.through - data.model.now) / 60000)} мин впереди текущих часов модели. Повторные события не увеличивают число уникальных строк. Уведомления при этом следуют текущим часам и продолжают отправляться.</p>`}
    <div class="kpis developer-kpis">${cards.map(([label, value, unit, note]) => html`<${Kpi} key=${label} label=${label} value=${num(value)} unit=${unit} note=${note} />`)}</div>
    <div class="developer-charts"><${Chart} history=${data.history} field="cpuPct" title="CPU во времени" unit="%" /><${Chart} history=${data.history} field="writeBytes" title="Запись в секунду" unit="байт/с" /></div>
    <section class="panel"><div class="panel-head"><h2>Вычисления по подсистемам</h2></div><div class="table-wrap"><table class="table"><thead><tr><th>Операция</th><th>Запусков</th><th>Среднее, мс</th><th>P95, мс</th><th>Максимум, мс</th><th>Ошибок</th></tr></thead><tbody>${data.operations.map(r => html`<tr key=${r.name}><th>${r.name}</th><td>${num(r.count)}</td><td>${num(r.averageMs)}</td><td>${num(r.p95Ms)}</td><td>${num(r.maxMs)}</td><td>${num(r.errors)}</td></tr>`)}</tbody></table></div><p class="developer-note">Среднее и максимум — с запуска процесса; P95 — последние 120 вызовов каждого типа. Вложенные замеры могут пересекаться: их время нельзя складывать как независимую нагрузку.</p></section>
    <section class="panel"><div class="panel-head"><h2>Что именно посчитано</h2></div><ul class="developer-list">${Object.entries(data.counters).map(([key, value]) => html`<li key=${key}><span>${names[key] || key}</span><strong class="num">${num(value)}</strong></li>`)}</ul><p class="developer-note">Только серверная среда. Вычисления вкладок посетителей не входят. Это счётчики определённых операций алгоритма, не число машинных инструкций. Кэш-попадание и построение профиля — разная работа.</p></section>
    <section class="panel"><div class="panel-head"><h2>Данные на диске и запись</h2></div><div class="table-wrap"><table class="table"><thead><tr><th>Набор данных</th><th>Размер файла</th><th>Записано с запуска</th><th>Операций записи</th><th>Новых событий</th></tr></thead><tbody>${data.files.map(f => html`<tr key=${f.name}><th>${f.name}</th><td>${f.bytes === null ? 'нет файла' : mb(f.bytes)}</td><td>${mb(data.writes[f.name]?.bytes || 0)}</td><td>${num(data.writes[f.name]?.writes || 0)}</td><td>${num(data.writes[f.name]?.records || 0)}</td></tr>`)}</tbody></table></div><p class="developer-note">Одна строка JSONL — одно событие. Снимки состояния и расписания перезаписываются: их байты учитываются в скорости записи, но не увеличивают количество исторических событий. Счётчики записи сбрасываются при перезапуске; архив сохраняется. Размер не равен суммарным записанным байтам.</p></section>
    <div class="developer-charts"><section class="panel"><div class="panel-head"><h2>Подключения и ресурсы</h2></div><ul class="developer-list">${Object.entries(data.streams).map(([k,v]) => html`<li><span>SSE · ${k}</span><strong>${v}</strong></li>`)}<li><span>Активные HTTP, включая SSE</span><strong>${data.http.active}</strong></li>${Object.entries(data.resources).map(([k,v]) => html`<li><span>${k}</span><strong>${v}</strong></li>`)}</ul></section>
    <section class="panel"><div class="panel-head"><h2>Очередь уведомлений</h2></div>${data.push ? html`<ul class="developer-list">${[['Подписок',data.push.subscriptions],['В очереди',data.push.queued],['Принято push-сервисом',data.push.accepted],['Показ подтверждён приложением',data.push.received],['Ошибок отправки',data.push.failed],['Устаревших подписок',data.push.expired],['Пропущено при переполнении',data.push.dropped]].map(([k,v]) => html`<li><span>${k}</span><strong>${v}</strong></li>`)}</ul>${data.push.lastError && html`<p class="developer-note bad">${data.push.lastError.reason} ${data.push.lastError.provider}</p>`}<p class="developer-note">Приём push-сервисом не равен показу на устройстве. Подтверждение приходит после showNotification; его отсутствие также возможно из-за отсутствия сети для обратного запроса.</p>` : html`<p class="developer-note bad">Сервис уведомлений недоступен.</p>`}</section></div>
    <section class="panel"><div class="panel-head"><h2>Состояние модели и планировщика</h2></div><ul class="developer-list"><li>Время модели: ${new Date(data.model.now).toLocaleString('ru-RU', {timeZone:'Asia/Almaty'})} · ×${data.model.speed} · ${data.model.running ? 'идёт' : 'пауза'}</li><li>Участок: ${data.model.trains} поездов, ${data.model.groups} групп вагонов, ${data.model.incidents} происшествий</li><li>План: ${data.plan.rows} рейсов, ${data.plan.fleet} локомотивов; ревизия ${data.plan.revision}</li><li>Назначение не завершено: ${data.plan.unassigned}. Исполнение плана: ${data.plan.executionEnabled ? 'включено' : 'прогноз, не команды движущимся поездам'}.</li></ul></section>
    <p class="muted">Диагностика только для чтения. Здесь нет ключей push, адресов подписок, паролей или команд управления сервером. Нагрузка самой диагностики входит в измерения.</p>`;
}
