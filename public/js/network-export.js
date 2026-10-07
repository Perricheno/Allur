import { useState } from 'preact/hooks';
import { html } from './lib.js';
import { Button } from './ui.js';

export function ExportButton({ section = 'all' }) {
  const label = { all: 'Все данные', trains: 'Поезда', stations: 'Станции', model: 'Модель', decisions: 'Решения', journal: 'Журнал' }[section];
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const run = async () => {
    setBusy(true); setError('');
    try {
      const res = await fetch(`/api/network-export?section=${section}`);
      if (!res.ok) throw new Error('Экспорт недоступен. Повторите после восстановления связи.');
      const blob = await res.blob(), url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `ktz-${section}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return html`<${Button} icon="download" pending=${busy} onClick=${run} title="Полный набор данных раздела, без ограничения строками на экране">${label} · JSON</${Button}>${error && html`<span role="alert" class="bad">${error}</span>`}`;
}
