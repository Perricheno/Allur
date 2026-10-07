// Общий список инцидентов маршрутов: опрос сервера, команды диспетчера, передача в модель движения.
import { useEffect, useState } from 'preact/hooks';
import { setNetworkIncidents } from './network-sim.js';

let state = { list: [], rev: 0, loaded: false, failed: false, offset: 0 };
const listeners = new Set();
let timer = null;
const publish = (patch) => { state = { ...state, ...patch }; for (const fn of listeners) fn(state); };
function accept(body) {
  setNetworkIncidents(body.incidents);
  publish({ list: body.incidents, rev: state.rev + 1, loaded: true, failed: false, offset: Date.now() - body.serverNow });
}
export async function refreshIncidents() {
  try { accept(await (await fetch('/api/net/incidents', { cache: 'no-store' })).json()); }
  catch { publish({ failed: true, loaded: true }); }
}
/** Команда диспетчера: { type: 'add'|'remove'|'approve'|'clear', ... }. Бросает Error с текстом сервера. */
export async function incidentAction(command) {
  const res = await fetch('/api/net/incidents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Не удалось выполнить команду');
  accept(body);
  return body;
}
export function useIncidents() {
  const [value, setValue] = useState(state);
  useEffect(() => {
    listeners.add(setValue);
    if (!timer) { refreshIncidents(); timer = setInterval(refreshIncidents, 5000); }
    setValue(state);
    return () => { listeners.delete(setValue); if (!listeners.size) { clearInterval(timer); timer = null; } };
  }, []);
  return value;
}
