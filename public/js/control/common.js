import { useEffect, useState } from 'preact/hooks';
import { createAllurModelClient } from '../allur-model-client.js';
export const client = createAllurModelClient();
export const STATUS = { idle: 'Ожидание', working: 'Работает', blocked: 'Выход заполнен', starved: 'Нет входящего потока', material_shortage: 'Нет материалов', down: 'Остановлен', changeover: 'Переналадка', no_staff: 'Нет операторов', no_utilities: 'Нет ресурсов', break: 'Перерыв', off_shift: 'Вне смены' };
export const MATERIALS = { onix: 'Комплекты Onix', cobalt: 'Комплекты Cobalt', j7: 'Комплекты JAC J7', engines: 'Двигатели', wheels: 'Колёса', batteries: 'Аккумуляторы', paintLiters: 'Покрытие, л' };
export const reasonText = reason => ({ waiting_crew: 'Ожидает ремонтную бригаду', waiting_parts: 'Ожидает ремкомплект', repairing: 'Идёт ремонт' }[reason] || (reason ? reason.split(', ').map(word => MATERIALS[word] || word).join(', ') : ''));
export const NAMES = { supply: 'Комплектующие', welding: 'Сварка', paint: 'Окраска', assembly: 'Сборка', quality: 'Контроль', finished: 'Отгрузка' };
export const num = (value, digits = 0) => value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('ru-RU', { maximumFractionDigits: digits });
export const percent = value => value === null || value === undefined ? '—' : `${num(value * 100, 1)}%`;
export const clock = seconds => `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}`;
export const money = value => `${num(value)} ₸`;
export const tone = status => ['down','no_utilities','material_shortage','no_staff'].includes(status) ? 'danger' : ['blocked','starved','changeover'].includes(status) ? 'warning' : status === 'working' ? 'good' : 'neutral';
export const pathValue = (object, key) => key.split('.').reduce((value, part) => value?.[part], object);
export function download(name, contents, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([contents], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function useModel() {
  const [state, setState] = useState(null), [catalog, setCatalog] = useState(null), [analysis, setAnalysis] = useState(null);
  const [connection, setConnection] = useState('connecting'), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    const accept = next => { if (alive) setState(previous => !previous || next.revision >= previous.revision ? next : previous); };
    const stop = client.subscribe(accept, value => { if (alive) setConnection(value); });
    Promise.all([client.state(), client.catalog()]).then(([s,c]) => { if (alive) { accept(s); setCatalog(c); } }).catch(e => { if (alive) setError(e.message); });
    const refresh = () => fetch('/api/analysis').then(r => { if (!r.ok) throw new Error('Analysis unavailable'); return r.json(); }).then(value => { if (alive) setAnalysis(value); }).catch(() => {});
    refresh(); const interval = setInterval(refresh, 5000);
    return () => { alive = false; stop(); clearInterval(interval); };
  }, []);
  async function command(value) {
    setBusy(true); setError('');
    try {
      const next = await client.command(value);
      setState(previous => !previous || next.revision >= previous.revision ? next : previous);
      // Refresh recommendations immediately after a user action, including a new demo.
      try { const response = await fetch('/api/analysis'); if (response.ok) setAnalysis(await response.json()); } catch {}
      return next;
    }
    catch (e) { setError(e.message); throw e; }
    finally { setBusy(false); }
  }
  return { state, catalog, analysis, connection, error, setError, busy, command };
}
