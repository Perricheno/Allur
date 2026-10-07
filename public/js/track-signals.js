// Светофор схемы: компонент. Аспекты считает signal-model.js.
import { html } from './lib.js';

const ASPECT_TEXT = { red: 'красный: занято или закрыто', yellow: 'жёлтый: следующий блок занят', green: 'зелёный: свободно' };
const LAMPS = [['red', -8], ['yellow', 0], ['green', 8]];

/** Светофор: опора к пути, корпус и три линзы; горит одна. */
export function Signal({ x, y, aspect, label, trackY }) {
  return html`<g transform=${`translate(${x} ${y})`} class="m-tl"><title>${`${label}: ${ASPECT_TEXT[aspect]}`}</title>
    ${trackY != null && html`<line x1="0" x2="0" y1="0" y2=${trackY - y} class="m-pole"/>`}
    <rect x="-6.5" y="-13.5" width="13" height="27" rx="6.5" class="m-sg-body"/>
    ${LAMPS.map(([name, cy]) => html`<circle key=${name} cy=${cy} r="3.3" class=${`lamp ${aspect === name ? `on-${name}` : 'off'}`}/>`)}</g>`;
}
