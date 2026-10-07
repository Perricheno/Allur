// Формулы модели на странице: уравнения с подсвечиваемыми переменными, таблицы переменных и покрытие факторов.
import { useMemo, useState } from 'preact/hooks';
import { html, Icon } from './lib.js';
import { Badge, Segmented } from './ui.js';
import { MODEL_PARAMS } from './network-sim.js';
import { SCHEDULE_DEFAULTS } from './schedule-engine.js';
import { MODEL_FACTORS, DISPLAY_ONLY_FACTORS, MISSING_FACTORS } from './model-factors.js';
import { MASTER, MASTER_VARIABLES, buildFormulaSpec } from './model-formula.js';
import * as dispatch from '/engine/dispatch.js';
import { fmt } from './engine-widgets.js';

const spec = buildFormulaSpec({ params: MODEL_PARAMS, dispatch, schedule: SCHEDULE_DEFAULTS });
const FACTORS = MODEL_FACTORS.filter(f => f.length === 3);

/** Переменная: основа, нижний и верхний индекс. */
function Var({ sym, info, active, onActive }) {
  const [main, sup] = sym.split('^'), cut = main.indexOf('_'), base = cut < 0 ? main : main.slice(0, cut), sub = cut < 0 ? '' : main.slice(cut + 1);
  return html`<var class=${`fv ${active === sym ? 'on' : ''}`} title=${info ? `${info.name}${info.unit ? `, ${info.unit}` : ''}` : sym} tabindex="0"
    onMouseEnter=${() => onActive(sym)} onMouseLeave=${() => onActive(null)} onFocus=${() => onActive(sym)} onBlur=${() => onActive(null)}>${base}${sub && html`<sub>${sub}</sub>`}${sup && html`<sup>${sup}</sup>`}</var>`;
}

/** Текст со вставками {переменная}, индексами _x и ^x. */
function Text({ text, vars, active, onActive }) {
  const parts = text.split(/(\{[^}]+\})/g);
  const plain = chunk => chunk.split(/(_[^\s;,)=:]+|\^[^\s;,)=:]+)/g).map((p, i) => (p.startsWith('_') ? html`<sub key=${i}>${p.slice(1)}</sub>` : p.startsWith('^') ? html`<sup key=${i}>${p.slice(1)}</sup>` : p));
  return html`${parts.map((p, i) => (p.startsWith('{') ? html`<${Var} key=${i} sym=${p.slice(1, -1)} info=${vars.get(p.slice(1, -1))} active=${active} onActive=${onActive} />` : plain(p)))}`;
}

function Equation({ eq, vars, active, onActive }) {
  return html`<li class="eq"><span class="eq-id">${eq.id}</span><div><div class="eq-label">${eq.label}</div>
    <div class="eq-math"><${Text} text=${eq.text} vars=${vars} active=${active} onActive=${onActive} /></div>${eq.note && html`<small class="muted">${eq.note}</small>`}</div></li>`;
}

function VariableTable({ system, query, active, onActive, sample, ctx }) {
  const rows = system.variables.filter(v => !query || `${v.sym} ${v.name}`.toLowerCase().includes(query.toLowerCase()));
  const eqOf = sym => system.equations.filter(e => e.text.includes(`{${sym}}`) || e.text.includes(`{${sym}}`)).map(e => e.id);
  return html`<div class="table-wrap"><table class="table vars"><thead><tr><th scope="col">Символ</th><th scope="col">Что это</th><th scope="col">Ед.</th><th scope="col">Значение</th><th scope="col">В уравнениях</th><th scope="col">Факторы</th></tr></thead>
    <tbody>${rows.map(v => {
      const live = v.live && sample ? v.live(sample, ctx) : null;
      return html`<tr key=${v.sym} class=${active === v.sym ? 'on' : ''} onMouseEnter=${() => onActive(v.sym)} onMouseLeave=${() => onActive(null)}>
        <th scope="row"><${Var} sym=${v.sym} info=${v} active=${active} onActive=${onActive} /></th><td>${v.name}</td><td class="muted">${v.unit}</td>
        <td class="num">${live != null ? html`<strong>${fmt(live)}</strong> <small class="muted">${v.liveNote}</small>` : v.value != null ? v.value : html`<span class="muted">вычисляется</span>`}</td>
        <td>${eqOf(v.sym).join(', ') || html`<span class="muted">—</span>`}</td><td><span class="chips">${v.factors.map(f => html`<${Badge} key=${f} tone="muted" title=${f}>${f.length > 26 ? `${f.slice(0, 25)}…` : f}</${Badge}>`)}</span></td></tr>`;
    })}</tbody></table></div>`;
}

/** Таблица покрытия: каждый фактор → переменные и уравнения. */
function Coverage({ vars }) {
  const byFactor = useMemo(() => {
    const m = new Map(FACTORS.map(f => [f[1], { group: f[0], name: f[1], syms: [], eqs: new Set() }]));
    for (const sys of spec) for (const v of sys.variables) for (const name of v.factors) {
      const e = m.get(name); if (!e) continue;
      e.syms.push(v.sym); for (const eq of sys.equations) if (eq.text.includes(`{${v.sym}}`)) e.eqs.add(eq.id);
    }
    for (const v of MASTER_VARIABLES) for (const name of v.factors) m.get(name)?.syms.push(v.sym);
    return [...m.values()];
  }, []);
  const groups = [...new Set(byFactor.map(f => f.group))];
  const [open, setOpen] = useState(false);
  const covered = byFactor.filter(f => f.syms.length).length;
  return html`<section class="coverage"><button type="button" class="btn btn-secondary" aria-expanded=${open} onClick=${() => setOpen(!open)}><${Icon} name=${open ? 'chevron-up' : 'chevron-down'} size=${16} /><span>Покрытие факторов: ${covered} из ${byFactor.length}</span></button>
    ${open && html`<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Подсистема</th><th scope="col">Фактор</th><th scope="col">Переменные</th><th scope="col">Уравнения</th></tr></thead>
      <tbody>${byFactor.map((f, i) => html`<tr key=${f.name}><td class="muted">${i === 0 || byFactor[i - 1].group !== f.group ? f.group : ''}</td><td>${f.name}</td>
        <td>${f.syms.map(s => html`<${Var} key=${s} sym=${s} info=${vars.get(s)} active=${null} onActive=${() => {}} />`).reduce((a, b) => [a, ' ', b], [])}</td><td>${[...f.eqs].join(', ') || '—'}</td></tr>`)}</tbody></table></div>
      <h4>Паспортные показатели, не самостоятельные ограничения</h4><ul class="plain-list">${DISPLAY_ONLY_FACTORS.map(x => html`<li key=${x}>${x}</li>`)}</ul>
      <h4>Пока не связаны с решениями в полном объёме</h4><ul class="plain-list">${MISSING_FACTORS.map(x => html`<li key=${x}>${x}</li>`)}</ul>`}</section>`;
}

export function FormulaBook({ sample, ctx }) {
  const [system, setSystem] = useState(spec[0].id);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(null);
  const vars = useMemo(() => new Map([...MASTER_VARIABLES, ...spec.flatMap(s => s.variables)].map(v => [v.sym, v])), []);
  const current = spec.find(s => s.id === system);
  const total = spec.reduce((n, s) => n + s.variables.length, 0) + MASTER_VARIABLES.length, eqs = spec.reduce((n, s) => n + s.equations.length, 0) + MASTER.length;
  return html`<div class="fbook">
    <p class="fbook-lead"><strong>${FACTORS.length}</strong> факторов → <strong>${total}</strong> переменных → <strong>${eqs}</strong> уравнений. Наведите курсор на переменную: она подсветится везде. Значения констант берутся из кода, «сейчас» — живые данные.</p>
    <section class="master" aria-label="Главные соотношения"><h3>Главные соотношения</h3><ul class="eqs">${MASTER.map(e => html`<${Equation} key=${e.id} eq=${e} vars=${vars} active=${active} onActive=${setActive} />`)}</ul></section>
    <div class="fbook-bar"><${Segmented} label="Подсистема" value=${system} onChange=${setSystem} options=${spec.map(s => ({ value: s.id, label: s.title }))} />
      <label class="search"><${Icon} name="search" size=${16} /><span class="sr-only">Найти переменную</span><input type="search" placeholder="Символ или название" value=${query} onInput=${e => setQuery(e.target.value)} /></label></div>
    <section class="system" aria-labelledby=${`sys-${current.id}`}><h3 id=${`sys-${current.id}`}>${current.title}</h3><p class="muted">${current.lead} <code>${current.src}</code></p>
      <ul class="eqs">${current.equations.map(e => html`<${Equation} key=${e.id} eq=${e} vars=${vars} active=${active} onActive=${setActive} />`)}</ul>
      <h4>Переменные (${current.variables.length})</h4><${VariableTable} system=${current} query=${query} active=${active} onActive=${setActive} sample=${sample} ctx=${ctx} /></section>
    <${Coverage} vars=${vars} />
  </div>`;
}
