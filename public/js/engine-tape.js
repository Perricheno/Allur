// Лента событий модели: что пришло на вход, что посчитано, какие решения приняты и что выдано.
import { useMemo, useState } from 'preact/hooks';
import { html, Icon } from './lib.js';
import { Badge, Empty, Segmented } from './ui.js';
import { DECISION } from './log.js';
import { hhmmss } from './engine-format.js';

const KINDS = [
  { value: 'all', label: 'Все' }, { value: 'in', label: 'Вход' }, { value: 'calc', label: 'Расчёт' }, { value: 'decision', label: 'Решения' }, { value: 'out', label: 'Результат' },
];
const BADGE = { in: { label: 'Вход', tone: 'neutral', icon: 'arrow-down-to-line' }, calc: { label: 'Расчёт', tone: 'accent', icon: 'cpu' }, out: { label: 'Результат', tone: 'ink', icon: 'check-check' } };

export function EventTape({ lines, limit = 60 }) {
  const [kind, setKind] = useState('all');
  const rows = useMemo(() => [...lines].reverse().filter(l => kind === 'all' || l.kind === kind).slice(0, limit), [lines, kind, limit]);
  return html`<div class="tape">
    <${Segmented} label="Тип записей" value=${kind} onChange=${setKind} options=${KINDS} />
    ${rows.length ? html`<ol class="tape-list" aria-live="off">${rows.map(l => {
      const b = l.kind === 'decision' ? { ...DECISION[l.tone], label: DECISION[l.tone].label } : BADGE[l.kind];
      return html`<li key=${l.id} class=${`tape-row ${l.kind}`}><time>${hhmmss(l.at)}</time><${Badge} tone=${b.tone} icon=${b.icon}>${b.label}</${Badge}><span class="tape-text">${l.text}</span>${l.value ? html`<span class="tape-value num">${l.value}</span>` : ''}</li>`;
    })}</ol>` : html`<${Empty} icon="radio" title="Записей пока нет">Данные появятся, как только модель получит первые изменения.</${Empty}>`}
  </div>`;
}
