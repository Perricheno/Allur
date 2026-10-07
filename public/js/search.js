import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { html, Icon } from './lib.js';
import { go, updateUi } from './store.js';
import { Dialog } from './ui.js';

/** Search changes only local navigation; it never issues a dispatch command. */
export function QuickSearch({ data, open, onClose }) {
  const [query, setQuery] = useState('');
  const input = useRef(null);
  useLayoutEffect(() => {
    if (!open) return;
    setQuery('');
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);
  const q = query.trim().toLocaleLowerCase('ru').replace(/^№\s*/, '');
  const trains = q ? data.trains.filter(t => `${t.number} ${t.label} ${data.stations[t.route[0][1]].name} ${data.stations[t.route.at(-1)[1]].name}`.toLocaleLowerCase('ru').includes(q)).slice(0, 6) : [];
  const stations = q ? data.stations.filter(s => `${s.id} ${s.name}`.toLocaleLowerCase('ru').includes(q)).slice(0, 6) : [];
  const selectTrain = t => { updateUi({ category: 'all', selectedTrain: t.number, windowStart: Math.max(0, t.forecast[0][0] - 30) }); onClose(); go('/overview?route=corridor'); };
  return html`<${Dialog} id="quick-search" open=${open} onClose=${onClose} title="Найти поезд или станцию">
    <label class="search quick-input"><${Icon} name="search" size=${18} /><span class="sr-only">Номер поезда или название станции</span><input ref=${input} type="search" placeholder="Например, 153 или Дария" value=${query} onInput=${e => setQuery(e.target.value)} /></label>
    <div class="quick-results">
      ${!q && html`<p class="search-hint">Введите номер поезда, его категорию или название станции. Поезд откроется на графике, станция — с данными грузовой работы.</p>`}
      ${q && !trains.length && !stations.length && html`<p role="status" class="search-hint">Ничего не найдено. Проверьте номер или сократите название станции.</p>`}
      ${trains.length > 0 && html`<section aria-label="Найденные поезда"><h3>Поезда</h3>${trains.map(t => html`<button key=${t.number} class="quick-result" onClick=${() => selectTrain(t)}><${Icon} name="train-front" size=${19} /><span><strong>№${t.number} · ${t.label}</strong><small>${data.stations[t.route[0][1]].name} → ${data.stations[t.route.at(-1)[1]].name}</small></span><${Icon} name="arrow-right" size=${16} /></button>`)}</section>`}
      ${stations.length > 0 && html`<section aria-label="Найденные станции"><h3>Станции</h3>${stations.map(s => html`<button key=${s.id} class="quick-result" onClick=${() => { onClose(); go(`/station/${s.id}`); }}><span class="code">${s.id}</span><span><strong>${s.name}</strong><small>${s.type} · ${s.km} км</small></span><${Icon} name="arrow-right" size=${16} /></button>`)}</section>`}
    </div>
    <p class="search-hint">Tab — выбрать результат · Enter — открыть · Esc — закрыть</p>
  </${Dialog}>`;
}
