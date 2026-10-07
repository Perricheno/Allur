import { refreshStationGeography } from './world.js';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { createState, snapshot, act, tick, advanceTime } from './model.js';
import { prepare, networkTrains, networkDecisions, networkStats, networkItinerary, setNetworkPlan, setNetworkIncidents } from '../public/js/network-sim.js';
import { NetIncidents } from './net-incidents.js';
import { operationalMetrics, fleetStandingMetrics } from '../public/js/operational-metrics.js';
import { NetworkArchive } from './network-archive.js';
import { buildStationIndex, stationBoard } from '../public/js/network-detail-data.js';
import { buildSchedule, scheduleEconomics } from '../public/js/schedule-engine.js';
import { replanLocally, extendSchedule, SERVICE_TYPES } from '../public/js/schedule-disruptions.js';
import { ECONOMIC_REFERENCE } from '../public/js/economic-reference.js';
import { JournalPush, LivePushCursor } from './push.js';
import { Telemetry } from './telemetry.js';
const telemetry = new Telemetry();

// KTZ_AUTOPLAY=0 — детерминированный режим для тестов: время стоит, события выключены, состояние не сохраняется.
// Иначе модель живёт в реальном времени: расписание строится непрерывно, события случаются сами, состояние хранится на диске.
const autoplay = process.env.KTZ_AUTOPLAY !== '0';
const STATE_FILE = process.env.KTZ_STATE || fileURLToPath(new URL('../data/state.json', import.meta.url));
const fresh = () => (autoplay
  ? Object.assign(createState({ now: Math.floor(Date.now() / 1000) * 1000, auto: { stations: true, intensity: 'normal', approve: true } }), { running: true, synced: true, speed: 1 })
  : createState());

function load() {
  if (!autoplay || !existsSync(STATE_FILE)) return fresh();
  try {
    const saved = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    if (saved.version !== 2) return fresh();
    saved.planRev = (saved.planRev || 0) + 1;
    delete saved.version;
    refreshStationGeography(saved);
    // Пока сервер не работал, жизнь шла: догоняем реальное время (не больше суток).
    const gap = (Date.now() - saved.now) / 60_000;
    if (gap > 0) {
      advanceTime(saved, Math.min(gap, 24 * 60));
      if (gap > 24 * 60) saved.now = Date.now();
    }
    saved.speed = 1; saved.synced = saved.now >= Date.now() - 120_000 ? saved.synced : false;
    return saved;
  } catch (error) {
    console.error('Не удалось загрузить состояние, начинаем заново:', error.message);
    return fresh();
  }
}
function save() {
  if (!autoplay) return;
  try {
    mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    const body = JSON.stringify({ ...state, version: 2 });
    writeFileSync(`${STATE_FILE}.tmp`, body);
    renameSync(`${STATE_FILE}.tmp`, STATE_FILE);
    telemetry.write('Состояние участка', Buffer.byteLength(body));
  } catch (error) { console.error('Не удалось сохранить состояние:', error.message); }
}
let state = load();
let journalPush;
try { journalPush = new JournalPush(autoplay ? path.dirname(STATE_FILE) : null); }
catch (error) { console.error('Push недоступен, приложение продолжает работу:', error.message); }
const routeData = JSON.parse(readFileSync(new URL('../public/data/kz-routes.json', import.meta.url), 'utf8'));
const stationData = JSON.parse(readFileSync(new URL('../public/data/kz-stations.json', import.meta.url), 'utf8'));
const network = prepare(routeData);
const netIncidents = new NetIncidents(path.join(path.dirname(STATE_FILE), 'net-incidents.json'), network.byId, autoplay);
setNetworkIncidents(netIncidents.list);
const publishIncidents = () => { setNetworkIncidents(netIncidents.list); return { incidents: netIncidents.list, serverNow: state.now }; };
let stationIndex;
const SCHEDULE_FILE = path.join(path.dirname(STATE_FILE), 'network-schedule.json');
let savedSchedule = { plan: null };
const scheduleClients = new Set();
function sendStream(set, message) {
  for (const res of set) {
    if (res.destroyed || res.writableEnded) { set.delete(res); continue; }
    if (res.writableLength > 8 * 1024 * 1024) { set.delete(res); res.end(); continue; }
    res.write(message);
  }
}
function registerStream(set, req, res) {
  set.add(res);
  const remove = () => set.delete(res);
  req.on('close', remove); res.on('close', remove); res.on('error', remove);
}
if (autoplay && existsSync(SCHEDULE_FILE)) {
  try { savedSchedule = JSON.parse(readFileSync(SCHEDULE_FILE, 'utf8')); }
  catch (error) { console.error('Не удалось прочитать расписание:', error); savedSchedule = { plan: null, error: 'Сохранённый план не удалось прочитать. Исходный файл сохранён.' }; }
}
function persistSchedule() {
  setNetworkPlan(network, savedSchedule.plan);
  if (autoplay) { const body = JSON.stringify(savedSchedule); mkdirSync(path.dirname(SCHEDULE_FILE), { recursive: true }); writeFileSync(`${SCHEDULE_FILE}.tmp`, body); renameSync(`${SCHEDULE_FILE}.tmp`, SCHEDULE_FILE); telemetry.write('Расписание', Buffer.byteLength(body)); }
  const message = `event: schedule\ndata: ${JSON.stringify(savedSchedule)}\n\n`;
  sendStream(scheduleClients, message);
}
if (savedSchedule.plan && savedSchedule.plan.version < 3 && autoplay) {
  const backup = `${SCHEDULE_FILE}.before-execution-v2.json`;
  if (!existsSync(backup)) writeFileSync(backup, JSON.stringify(savedSchedule));
}
if (!savedSchedule.plan || savedSchedule.plan.version < 3) {
  const plan = buildSchedule(network, state.now);
  savedSchedule = { plan, auto: true, rates: { ...ECONOMIC_REFERENCE }, savedAt: Date.now() };
  persistSchedule();
}
setNetworkPlan(network, savedSchedule.plan);
function applyScheduleIncident(incident) {
  if (savedSchedule.plan.constraints?.some(c => c.id === incident.id)) return;
  const plan = telemetry.measure('Локальный пересчёт', () => replanLocally(savedSchedule.plan, incident, state.now));
  savedSchedule = { ...savedSchedule, plan, auto: true, savedAt: Date.now(), economics: scheduleEconomics(plan, savedSchedule.rates) };
  persistSchedule();
}
let archive;
try { archive = new NetworkArchive({ sim: network, now: state.now, file: autoplay ? path.join(path.dirname(STATE_FILE), 'network-events.jsonl') : null, onWrite: (bytes, records) => telemetry.write('Журнал', bytes, records) }); }
catch (error) { console.error('Архив сети недоступен (движение продолжено, файл сохранён):', error); }
const networkClients = new Set();
const livePush = new LivePushCursor(state.now);
function archiveTick() {
  journalPush?.enqueue(livePush.advance(network, state.now));
  if (!archive) return;
  const events = archive.advance(state.now);
  for (const e of events) if (e.kind === 'repair' && e.dwell > 0 && e.at + e.dwell * 60000 > state.now) {
    const locoId = e.locoId || `active:${e.uid}`;
    if (savedSchedule.plan.fleet.some(l => l.id === locoId)) applyScheduleIncident({ id: e.id, locoId, from: e.at, until: e.at + e.dwell * 60000, reason: `Неисправность №${e.number}: ${e.station}` });
  }
  if (events.length) {
    const message = `event: batch\ndata: ${JSON.stringify({ events, through: state.now })}\n\n`;
    sendStream(networkClients, message);
  }
}
const clients = new Set();
const developerClients = new Set();
const developerSnapshot = () => telemetry.sample({ state, archive, plan: savedSchedule.plan, push: journalPush,
  streams: { state: clients.size, journal: networkClients.size, schedule: scheduleClients.size, developers: developerClients.size },
  files: autoplay ? [['Состояние участка', STATE_FILE], ['Расписание', SCHEDULE_FILE], ['Журнал', path.join(path.dirname(STATE_FILE), 'network-events.jsonl')]] : [] });
const publicRoot = new URL('../public/', import.meta.url);
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const publicDir = fileURLToPath(publicRoot);
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
const longCache = new Set(['.woff2', '.png']);
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
function broadcast() {
  const message = `data: ${JSON.stringify(telemetry.measure('Снимок участка', () => snapshot(state)))}\n\n`;
  sendStream(clients, message);
}
const clock = () => `event: clock\ndata: ${JSON.stringify({ now: state.now, running: state.running, speed: state.speed, synced: state.synced })}\n\n`;
// Ход времени: раз в секунду. Реальный ход (×1) идёт всегда; ускорение — только пока кто-то смотрит.
// Полный снимок — при изменении данных и раз в 5 секунд, состояние на диск — раз в 20 секунд.
let ticks = 0;
const timer = setInterval(() => {
  ticks += 1;
  if (state.speed > 1 && !clients.size) { state.speed = 1; state.synced = false; }
  let changed = false;
  try { changed = telemetry.measure('Шаг модели', () => tick(state, 1, Date.now())); } catch (error) { console.error('Ошибка шага модели:', error); }
  try { telemetry.measure('Архив событий', archiveTick); } catch (error) { console.error('Ошибка архива сети:', error); }
  try {
    const plan = telemetry.measure('Продление расписания', () => extendSchedule(network, savedSchedule.plan, state.now));
    if (plan !== savedSchedule.plan) { savedSchedule = { ...savedSchedule, plan, economics: scheduleEconomics(plan, savedSchedule.rates) }; persistSchedule(); }
  } catch (error) { console.error('Ошибка продления расписания:', error); }
  if (clients.size) {
    if (changed || ticks % 5 === 0) broadcast();
    else for (const res of clients) res.write(clock());
  }
  if (ticks % 20 === 0) save();
  const diagnostics = developerSnapshot();
  if (developerClients.size) sendStream(developerClients, `event: telemetry\ndata: ${JSON.stringify(diagnostics)}\n\n`);
}, 1000);
const server = http.createServer(async (req, res) => {
  telemetry.request(req, res);
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/api/developer-metrics') return json(res, 200, telemetry.latest || developerSnapshot());
    if (req.method === 'GET' && url.pathname === '/api/developer-events') {
      if (developerClients.size >= 30) return json(res, 503, { error: 'Лимит диагностических подключений, повторите позже' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(`event: telemetry\ndata: ${JSON.stringify(telemetry.latest || developerSnapshot())}\n\n`);
      registerStream(developerClients, req, res); return;
    }
    if (req.method === 'GET' && url.pathname === '/api/push/config') return json(res, journalPush ? 200 : 503, journalPush ? { publicKey: journalPush.data.vapid.publicKey } : { error: 'Push недоступен' });
    if (req.method === 'POST' && ['/api/push/subscribe', '/api/push/unsubscribe', '/api/push/status', '/api/push/test', '/api/push/receipt'].includes(url.pathname)) {
      if (req.headers.origin && ![`http://${req.headers.host}`, `https://${req.headers.host}`].includes(req.headers.origin)) return json(res, 403, { error: 'Недопустимый источник запроса' });
      if (!journalPush) return json(res, 503, { error: 'Push недоступен' });
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 8192) return json(res, 413, { error: 'Слишком большой запрос' }); }
      const input = JSON.parse(body);
      if (url.pathname.endsWith('/receipt')) return json(res, 200, { ok: journalPush.receipt(input.token) });
      if (url.pathname.endsWith('/status')) return json(res, 200, journalPush.status(input));
      if (url.pathname.endsWith('/test')) return json(res, 200, await journalPush.test(input));
      if (url.pathname.endsWith('/unsubscribe')) journalPush.remove(input); else journalPush.add(input);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/net/incidents') {
      if (netIncidents.expire(state.now)) publishIncidents();
      return json(res, 200, { incidents: netIncidents.list, serverNow: state.now });
    }
    if (req.method === 'POST' && url.pathname === '/api/net/incidents') {
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, { error: 'Недопустимый источник запроса' });
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 4096) return json(res, 413, { error: 'Слишком большой запрос' }); }
      const input = JSON.parse(body);
      try {
        if (input.type === 'add') netIncidents.add(input.incident || {}, state.now);
        else if (input.type === 'remove') { if (!netIncidents.remove(String(input.id))) throw new Error('Событие не найдено'); }
        else if (input.type === 'approve') netIncidents.approve(String(input.id), String(input.variant), input.approved !== false);
        else if (input.type === 'clear') netIncidents.clear(input.routeId ? String(input.routeId) : null);
        else throw new Error('Неизвестная команда');
      } catch (error) { return json(res, 400, { error: error.message }); }
      return json(res, 200, publishIncidents());
    }
    if (req.method === 'GET' && url.pathname === '/api/schedule-events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(`event: schedule\ndata: ${JSON.stringify(savedSchedule)}\n\n`);
      registerStream(scheduleClients, req, res); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/schedule-incident') {
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, { error: 'Недопустимый источник запроса' });
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 8192) return json(res, 413, { error: 'Слишком большой запрос' }); }
      const input = JSON.parse(body), service = SERVICE_TYPES[input.service];
      if (!service || !savedSchedule.plan.fleet.some(l => l.id === input.locoId)) return json(res, 400, { error: 'Выберите локомотив и вид работ' });
      const from = state.now;
      applyScheduleIncident({ id: `service:${from}:${input.locoId}:${input.service}`, locoId: input.locoId, from, until: from + service.minutes * 60000, reason: service.label });
      return json(res, 200, savedSchedule);
    }
    if (req.method === 'POST' && url.pathname === '/api/schedule-route-incident') {
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, { error: 'Недопустимый источник запроса' });
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 8192) return json(res, 413, { error: 'Слишком большой запрос' }); }
      const input = JSON.parse(body);
      if (!network.byId.has(input.routeId) || !['fwd', 'rev', 'all'].includes(input.dir) || !Number.isFinite(input.minutes) || input.minutes < 15 || input.minutes > 720) return json(res, 400, { error: 'Проверьте маршрут, направление и длительность 15–720 минут' });
      const from = state.now;
      applyScheduleIncident({ id: `route:${from}:${input.routeId}:${input.dir}`, routeId: input.routeId, dir: input.dir, from, until: from + input.minutes * 60000, reason: `Запрет отправлений: ${network.byId.get(input.routeId).name}, ${input.dir === 'all' ? 'оба направления' : input.dir === 'fwd' ? 'прямое направление' : 'обратное направление'}` });
      return json(res, 200, savedSchedule);
    }
    if (req.method === 'GET' && url.pathname === '/api/schedule') return json(res, 200, savedSchedule);
    if (req.method === 'POST' && url.pathname === '/api/schedule') {
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, { error: 'Недопустимый источник запроса' });
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 8192) return json(res, 413, { error: 'Слишком большой запрос' }); }
      const input = JSON.parse(body);
      if (!Number.isFinite(input.createdAt) || input.createdAt > state.now + 2000 || input.createdAt < state.now - 7 * 86400000) return json(res, 400, { error: 'Пересчитайте план на актуальное время' });
      if (input.routeId !== 'all' && !network.byId.has(input.routeId)) return json(res, 400, { error: 'Неизвестный маршрут' });
      // Do not recreate physical locomotives or move already departed trains when saving a preview.
      if (savedSchedule.plan?.executionEnabled && (JSON.stringify(input.config) !== JSON.stringify(savedSchedule.plan.config) || input.routeId !== savedSchedule.plan.routeId)) return json(res, 409, { error: 'Действующее расписание уже исполняется. Изменение пула и параметров требует нового согласованного плана; используйте локальные события. Тарифы можно сохранить отдельно без изменения параметров.' });
      const plan = savedSchedule.plan?.executionEnabled ? savedSchedule.plan : buildSchedule(network, input.createdAt, input.config, input.routeId);
      const economics = scheduleEconomics(plan, input.rates);
      const next = { savedAt: Date.now(), plan, rates: economics.rates, economics };
      savedSchedule = next;
      persistSchedule();
      return json(res, 200, savedSchedule);
    }
    if (req.method === 'GET' && url.pathname === '/api/network-events') {
      if (!archive) return json(res, 503, { error: 'Архив сети недоступен' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(`event: archive\ndata: ${JSON.stringify(archive.snapshot(Infinity))}\n\n`);
      registerStream(networkClients, req, res); return;
    }
    if (req.method === 'GET' && url.pathname === '/api/network-export') {
      if (!archive) return json(res, 503, { error: 'Архив сети недоступен' });
      const section = url.searchParams.get('section') || 'all';
      if (!['all', 'trains', 'stations', 'model', 'decisions', 'journal'].includes(section)) return json(res, 400, { error: 'Неизвестный раздел' });
      const now = state.now, trains = networkTrains(network, now);
      const data = { schemaVersion: 1, exportedAt: new Date().toISOString(), modelTime: now, archiveStartedAt: archive.startedAt,
        scope: { trains: 'active trips at modelTime', stations: 'all indexed stations with current operations', journal: 'all archived events through modelTime', decisions: 'current analysis and archived operations' } };
      const has = key => section === 'all' || section === key;
      if (has('trains')) data.trains = trains.map(t => ({ ...t, itinerary: networkItinerary(network, t) }));
      if (has('stations')) {
        stationIndex ||= buildStationIndex(network, stationData);
        data.stations = { source: stationData, operational: stationIndex.map(r => ({ ...r, ...stationBoard(network, r, trains, now) })) };
      }
      if (has('model')) data.model = { routes: routeData, services: network.services, statistics: networkStats(trains), operationalMetrics: operationalMetrics(trains, archive.snapshot(now).events), fleetStanding: fleetStandingMetrics(savedSchedule.plan), dispatcher: snapshot(state), schedule: savedSchedule };
      if (has('decisions')) data.decisions = { current: networkDecisions(trains), history: archive.snapshot(now).events };
      if (has('journal')) data.journal = archive.snapshot(now);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="ktz-${section}.json"` });
      return res.end(JSON.stringify(data));
    }
    if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, snapshot(state));
    if (req.method === 'GET' && url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify(snapshot(state))}\n\n`);
      registerStream(clients, req, res); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/action') {
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, { error: 'Недопустимый источник запроса' });
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 8192) return json(res, 413, { error: 'Слишком большой запрос' });
      }
      const action = JSON.parse(body);
      if (action?.type === 'reset') { state = fresh(); save(); }
      else telemetry.measure('Команда диспетчера', () => act(state, action));
      archiveTick(); broadcast(); return json(res, 200, snapshot(state));
    }
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Метод API не найден' });
    if (req.method !== 'GET') return json(res, 405, { error: 'Метод не поддерживается' });
    if (url.pathname === '/healthz') return json(res, 200, { ok: true });
    // Движок расчёта открыт клиенту: страница «Как это работает» запускает его в песочнице.
    if (['/engine/model.js', '/engine/dispatch.js', '/engine/world.js', '/engine/rail-corridor.js'].includes(url.pathname)) {
      const body = await readFile(fileURLToPath(new URL(`./${path.basename(url.pathname)}`, import.meta.url)));
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      return res.end(body);
    }
    // Любой путь без расширения — клиентский маршрут (SPA), отдаём index.html.
    let rel = decodeURIComponent(url.pathname);
    if (!path.extname(rel)) rel = '/index.html';
    const file = path.resolve(publicDir, '.' + rel);
    if (!file.startsWith(publicDir)) return json(res, 404, { error: 'Страница не найдена' });
    const ext = path.extname(file);
    if (!mime[ext]) return json(res, 404, { error: 'Страница не найдена' });
    let content;
    try { content = await readFile(file); } catch { return json(res, 404, { error: 'Страница не найдена' }); }
    res.writeHead(200, {
      'Content-Type': `${mime[ext]}${ext === '.woff2' || ext === '.png' ? '' : '; charset=utf-8'}`,
      'Cache-Control': longCache.has(ext) ? 'public, max-age=86400' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(content);
  } catch (error) {
    json(res, 400, { error: error instanceof SyntaxError ? 'Некорректный JSON' : error.message });
  }
});
const heartbeat = setInterval(() => { for (const res of [...clients, ...networkClients, ...scheduleClients]) res.write(': heartbeat\n\n'); }, 1000);
server.listen(port, host, () => console.log(`Автодиспетчер: http://${host}:${port}`));
server.on('error', error => { console.error(error.message); clearInterval(heartbeat); clearInterval(timer); process.exit(1); });
process.on('SIGTERM', () => { save(); telemetry.close(); clearInterval(heartbeat); clearInterval(timer); for (const client of [...clients, ...networkClients, ...scheduleClients, ...developerClients]) client.end(); server.close(); });
