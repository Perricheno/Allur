import { useEffect, useRef, useState } from 'preact/hooks';

// Единый источник состояния клиента: серверный снимок + локальные настройки интерфейса.
const listeners = new Set();
export const clock = { now: 0, at: 0, running: false, speed: 1, synced: false };
/** Текущее модельное время, мс: между сообщениями сервера «идёт» плавно. */
export const liveNow = () => (clock.running ? clock.now + (performance.now() - clock.at) * clock.speed : clock.now);
function setClock(c) { clock.now = c.now; clock.at = performance.now(); clock.running = c.running; clock.speed = c.speed; clock.synced = Boolean(c.synced); }

/** Перерисовка компонента с частотой fps (для плавного движения и часов). */
export function useLiveNow(fps = 1) {
  const [, set] = useState(0);
  useEffect(() => {
    let raf = 0, last = 0;
    const loop = t => { if (t - last >= 1000 / fps) { last = t; set(n => n + 1); } raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [fps]);
  return liveNow();
}

export const app = {
  data: null, online: false, failed: false, busy: false,
  route: { page: 'network', params: {} },
  ui: { category: 'all', selectedTrain: null, selectedStation: null, selectedNetTrain: null, mapFocus: null, zoom: 8, shift: 0, follow: true },
  toasts: [],
};

let version = 0;
function emit() { version += 1; for (const l of listeners) l(); }
export function update(patch) { Object.assign(app, patch); emit(); }
export function updateUi(patch) { app.ui = { ...app.ui, ...patch }; emit(); }

export function useApp() {
  const [, set] = useState(0);
  const seen = useRef(version);
  seen.current = version;
  useEffect(() => {
    const l = () => set(n => n + 1);
    listeners.add(l);
    // Обновление могло прийти между первым рендером и подпиской — не теряем его.
    if (seen.current !== version) l();
    return () => listeners.delete(l);
  }, []);
  return app;
}

// ---- уведомления на экране ----
let toastId = 0;
export function toast(text, kind = 'info') {
  const id = ++toastId;
  app.toasts = [...app.toasts.slice(-3), { id, text, kind }];
  emit();
  setTimeout(() => dismissToast(id), kind === 'error' ? 9000 : 5500);
}
export function dismissToast(id) { app.toasts = app.toasts.filter(t => t.id !== id); emit(); }

// ---- маршрутизация по hash: #/  #/trains  #/stations  #/station/D/arrivals  #/log ----
export function parseHash(hash = location.hash) {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  const params = Object.fromEntries(new URLSearchParams(query));
  if (!parts.length) return { page: 'network', params };
  if (parts[0] === 'station') return { page: 'station', params: { ...params, id: parts[1], tab: parts[2] || 'tracks' } };
  if (['trains', 'stations', 'log', 'decisions', 'how', 'map', 'fleet', 'overview', 'model', 'engine', 'stats', 'schedules', 'developers'].includes(parts[0])) return { page: parts[0], params };
  return { page: 'network', params };
}
export const href = (path = '/') => `#${path}`;
export function go(path) { location.hash = path; }

function syncRoute() {
  const route = parseHash();
  if (route.params.train && app.data?.trains.some(t => t.number === route.params.train)) app.ui = { ...app.ui, selectedTrain: route.params.train };
  app.route = route;
  emit();
  window.scrollTo({ top: 0 });
}
window.addEventListener('hashchange', syncRoute);
app.route = parseHash();

// ---- связь с сервером ----
export function connect() {
  const source = new EventSource('/api/events');
  const receive = next => {
    setClock(next);
    const same = app.data && next.revision === app.data.revision && next.now === app.data.now;
    const first = !app.data;
    update(same ? { online: true } : { data: next, online: true, failed: false });
    // ссылка вида #/?train=153 выбирает поезд, как только пришли данные
    if (first && app.route.params.train && next.trains.some(t => t.number === app.route.params.train)) updateUi({ selectedTrain: app.route.params.train });
  };
  source.onopen = () => update({ online: true, failed: false });
  source.onmessage = e => { try { receive(JSON.parse(e.data)); } catch { update({ online: false, failed: !app.data }); } };
  source.addEventListener('clock', e => setClock(JSON.parse(e.data)));
  source.onerror = () => update({ online: false, failed: !app.data });
  // SSE иногда буферизуется мобильным браузером или промежуточным прокси. Первичный
  // снимок через обычный GET гарантирует, что экран не останется на «Подключение…».
  fetch('/api/state', { cache: 'no-store' })
    .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
    .then(receive)
    .catch(() => { if (!app.data) update({ failed: true }); });
}

export async function act(payload) {
  if (app.busy || !app.online) return false;
  update({ busy: true });
  try {
    const res = await fetch('/api/action', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Не удалось выполнить действие');
    setClock(data);
    update({ data, busy: false });
    if (payload.type !== 'clock') toast(data.log[0].text);
    return true;
  } catch (e) {
    update({ busy: false });
    toast(e.name === 'TimeoutError' ? 'Сервер не ответил за 8 секунд. Проверьте соединение.' : e.message, 'error');
    return false;
  }
}
