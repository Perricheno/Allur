import { useEffect, useState } from 'preact/hooks';
import { html, Icon } from './lib.js';
import { Button } from './ui.js';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Автовоспроизведение шагов с паузой. */
export function usePlayer(length, ms = 4200, autoplay = true) {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(autoplay && !reduced());
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setI(n => (n + 1) % length), ms);
    return () => clearInterval(id);
  }, [playing, length, ms]);
  return { i, setI: v => { setPlaying(false); setI(v); }, playing, toggle: () => setPlaying(p => !p), next: () => { setPlaying(false); setI(n => (n + 1) % length); }, prev: () => { setPlaying(false); setI(n => (n + length - 1) % length); } };
}

export function PlayerControls({ player, length, labels }) {
  return html`<div class="player" role="group" aria-label="Управление демонстрацией">
    <${Button} variant="secondary" size="sm" icon="chevron-left" label="Предыдущий шаг" onClick=${player.prev} />
    <${Button} variant="secondary" size="sm" icon=${player.playing ? 'pause' : 'play'} onClick=${player.toggle}>${player.playing ? 'Пауза' : 'Играть'}</${Button}>
    <${Button} variant="secondary" size="sm" icon="chevron-right" label="Следующий шаг" onClick=${player.next} />
    <ol class="dots">${Array.from({ length }, (_, k) => html`<li key=${k}><button type="button" class=${k === player.i ? 'on' : ''} aria-label=${`Шаг ${k + 1}: ${labels[k]}`} aria-current=${k === player.i ? 'step' : undefined} onClick=${() => player.setI(k)}></button></li>`)}</ol>
  </div>`;
}

// ---------------------------------------------------------------- проблема

const PHASES = [
  { title: 'Всё идёт по графику', text: 'Два пути, два направления. Нечётный №153 идёт к станции D, чётный грузовой — к станции E. Они расходятся на разных путях.',
    F: [300, 87, 'go'], P: [700, 187, 'go'], derail: false, hold: false },
  { title: 'Сход на перегоне', text: 'Сошёл грузовой состав, нечётный путь закрыт. Пассажирский №153 остановился перед местом схода. Полностью останавливать участок нельзя.',
    F: [400, 87, 'go'], P: [650, 187, 'stop'], derail: true, hold: false },
  { title: 'Конфликт', text: 'Пассажирскому разрешено идти по соседнему (чётному) пути — по неправильному. Но по нему навстречу идёт грузовой: на одном пути встречные поезда нельзя.',
    F: [470, 87, 'go'], P: [610, 87, 'go'], derail: true, hold: false, clash: true },
  { title: 'Система предлагает решение', text: 'Приоритет у пассажирского. Грузовой принимается на боковой путь станции D и ждёт, пассажирский проходит перегон по неправильному пути.',
    F: [165, 140, 'stop'], P: [300, 87, 'go'], derail: true, hold: true },
  { title: 'Движение восстановлено', text: 'Пассажирский проследовал, грузовой выходит на перегон. Опоздания рассчитаны, пассажиры получили новое время прибытия.',
    F: [520, 87, 'go'], P: [110, 87, 'go'], derail: true, hold: false },
];

function Train({ x, y, label, dir, tone, state }) {
  return html`<g class=${`train train-${tone} ${state}`} style=${`transform:translate(${x}px,${y}px)`}>
    <rect x="-44" y="-13" width="88" height="26" rx="8" />
    <path d=${dir === 'right' ? 'M44 -7 L56 0 L44 7 Z' : 'M-44 -7 L-56 0 L-44 7 Z'} />
    <text y="4.5" text-anchor="middle">${label}</text>
  </g>`;
}

export function ProblemDemo() {
  const pl = usePlayer(PHASES.length, 5200);
  const ph = PHASES[pl.i];
  return html`<div class="demo problem">
    <svg viewBox="0 0 920 270" role="img" aria-label="Схема перегона D–E: два пути, сход на нечётном пути и объезд по соседнему">
      <rect x="10" y="40" width="110" height="190" rx="14" class="st"/><text x="65" y="64" text-anchor="middle" class="st-label">Станция D</text>
      <rect x="800" y="40" width="110" height="190" rx="14" class="st"/><text x="855" y="64" text-anchor="middle" class="st-label">Станция E</text>
      <line x1="120" y1="87" x2="800" y2="87" class="rail"/><line x1="120" y1="187" x2="800" y2="187" class="rail"/>
      <line x1="120" y1="140" x2="250" y2="140" class="rail side"/>
      <text x="460" y="68" text-anchor="middle" class="track-label">чётный путь →</text>
      <text x="460" y="214" text-anchor="middle" class="track-label">← нечётный путь</text>
      <text x="258" y="144" class="track-label">боковой путь</text>
      <g class=${`closed ${ph.derail ? 'on' : ''}`}>
        <rect x="500" y="168" width="130" height="38" rx="6" class="hatch-box"/>
        <g transform="translate(565 187)"><circle r="17" class="warn-dot"/><path d="M0 -7 V2 M0 7 V7.5" class="warn-mark"/></g>
        <text x="565" y="238" text-anchor="middle" class="closed-label">путь закрыт</text>
      </g>
      <${Train} x=${ph.F[0]} y=${ph.F[1]} label="3116" dir="right" tone="freight" state=${ph.F[2]} />
      <${Train} x=${ph.P[0]} y=${ph.P[1]} label="№153" dir="left" tone="passenger" state=${ph.P[2]} />
      <g class=${`clash ${ph.clash ? 'on' : ''}`} transform="translate(540 87)"><circle r="24" class="clash-ring"/><circle r="9" class="clash-core"/></g>
      <g class=${`hold ${ph.hold ? 'on' : ''}`} transform="translate(165 168)"><rect x="-38" y="-11" width="76" height="22" rx="11"/><text y="4" text-anchor="middle">ждёт</text></g>
    </svg>
    <div class="demo-caption" aria-live="polite"><span class="step-no">${pl.i + 1} / ${PHASES.length}</span><div><h3>${ph.title}</h3><p>${ph.text}</p></div></div>
    <${PlayerControls} player=${pl} length=${PHASES.length} labels=${PHASES.map(p => p.title)} />
  </div>`;
}

const MODEL_STEPS = [
  ['radio-tower', 'Получаем факт', 'Сигнал, закрытие пути или ограничение скорости становятся событием с местом и временем.'],
  ['chart-gantt', 'Сверяем график', 'Для каждого поезда строится прогнозная нитка: где он окажется и когда подойдёт к перегону.'],
  ['triangle-alert', 'Ищем конфликт', 'Система отмечает поезда, которые хотят занять один путь одновременно.'],
  ['calculator', 'Считаем варианты', 'По приоритету, пакетами или по очереди: для каждого варианта считаются задержки.'],
  ['badge-check', 'Подтверждает человек', 'Только после выбора диспетчера меняется рабочий прогноз.'],
  ['bell-ring', 'Обновляем всех', 'На ГИД появляются новые времена, а пассажиры получают уведомление.'],
];

export function ModelFlow() {
  const pl = usePlayer(MODEL_STEPS.length, 4600);
  const [, title, text] = MODEL_STEPS[pl.i];
  return html`<div class="demo model-flow"><div class="model-diagram" role="img" aria-label=${`Цепочка работы модели, шаг ${pl.i + 1}: ${title}`}>
    ${MODEL_STEPS.map(([icon, label], i) => html`<div key=${label} class=${`model-node ${i === pl.i ? 'on' : ''} ${i < pl.i ? 'done' : ''}`}><span class="model-icon"><${Icon} name=${i < pl.i ? 'check' : icon} size=${18} /></span><small>${i + 1}. ${label}</small></div>`)}
    <i class="model-pulse" style=${`--step:${pl.i}`}></i></div>
    <div class="demo-caption" aria-live="polite"><span class="step-no">${pl.i + 1} / ${MODEL_STEPS.length}</span><div><h3>${title}</h3><p>${text}</p></div></div>
    <div class="model-rule"><${Icon} name="user-round-check" size=${17} /><span><strong>Важно:</strong> модель предлагает и объясняет; закрытие пути, выбор варианта и подтверждение остаются за диспетчером.</span></div>
    <${PlayerControls} player=${pl} length=${MODEL_STEPS.length} labels=${MODEL_STEPS.map(x => x[1])} /></div>`;
}

// ---------------------------------------------------------------- факторы

const FACTORS = [
  { id: 'priority', icon: 'users', title: 'Приоритет поезда', text: 'Пассажирские идут первыми, затем контейнерные и транзитные, затем сборные. Низкоприоритетный поезд ждёт на станции, но не дольше 45 минут.', affects: 'очерёдность на перегоне', fact: '1 → 2 → 3' },
  { id: 'wrong', icon: 'arrow-left-right', title: 'Неправильный путь', text: 'Движение против обычного направления идёт медленнее из-за стрелочных переводов: время хода растёт в 1,25 раза.', affects: 'время хода по перегону', fact: '× 1,25' },
  { id: 'speed', icon: 'gauge', title: 'Ограничение скорости', text: 'После ремонта поезда идут медленнее. Время хода по перегону растёт пропорционально 80 км/ч ÷ ограничение.', affects: 'время хода всех поездов на перегоне', fact: '80 ÷ 25 = × 3,2' },
  { id: 'meet', icon: 'shuffle', title: 'Встречные на одном пути', text: 'Когда путь один, встречные поезда не могут быть на нём одновременно (зазор 3 минуты). Попутные идут с интервалом 6 минут.', affects: 'кто ждёт, а кто едет', fact: '3 мин / 6 мин' },
  { id: 'deadline', icon: 'calendar-clock', title: 'Срок доставки', text: 'Для грузовых групп вагонов считается запас: срок − прибытие − обработка − 30 минут на уборку. Меньше запас — раньше в очереди.', affects: 'порядок приёма вагонов на станции', fact: 'запас = срок − ETA − работа' },
  { id: 'capacity', icon: 'warehouse', title: 'Ёмкость пути', text: 'Группа вагонов принимается целиком на подходящий по специализации путь. Путь освобождается только после уборки.', affects: 'можно ли принять группу сейчас', fact: 'принять → обработать → убрать' },
];

function FactorArt({ id }) {
  if (id === 'priority') return html`<svg viewBox="0 0 220 96" aria-hidden="true" class="art art-priority">
    <g class="row r1"><rect x="8" y="8" width="150" height="20" rx="6" class="b-gray"/><text x="16" y="22">№3123 сборный</text></g>
    <g class="row r2"><rect x="8" y="38" width="150" height="20" rx="6" class="b-ink"/><text x="16" y="52">№2136 контейнерный</text></g>
    <g class="row r3"><rect x="8" y="68" width="150" height="20" rx="6" class="b-acc"/><text x="16" y="82">№153 пассажирский</text></g>
    <text x="172" y="22" class="mut">3</text><text x="172" y="52" class="mut">2</text><text x="172" y="82" class="mut">1</text></svg>`;
  if (id === 'wrong') return html`<svg viewBox="0 0 220 96" aria-hidden="true" class="art art-wrong">
    <rect x="10" y="18" width="120" height="16" rx="5" class="b-ink"/><text x="140" y="31" class="mut">по прямому пути</text>
    <rect x="10" y="56" width="120" height="16" rx="5" class="b-acc grow"/><text x="10" y="86" class="mut grow-t">по неправильному пути +25%</text></svg>`;
  if (id === 'speed') return html`<svg viewBox="0 0 220 96" aria-hidden="true" class="art art-speed">
    <path d="M30 80 A52 52 0 0 1 134 80" class="gauge-bg"/><g class="needle"><line x1="82" y1="80" x2="82" y2="38"/></g><circle cx="82" cy="80" r="5" class="hub"/>
    <text x="150" y="40" class="mut">норма 80</text><text x="150" y="62" class="num-big">25 км/ч</text><rect x="150" y="72" width="60" height="8" rx="4" class="b-acc travel"/></svg>`;
  if (id === 'meet') return html`<svg viewBox="0 0 220 96" aria-hidden="true" class="art art-meet">
    <line x1="8" y1="48" x2="212" y2="48" class="rail"/>
    <g class="a"><rect x="20" y="30" width="110" height="18" rx="6" class="b-acc"/><text x="28" y="43">№153 →</text></g>
    <g class="b"><rect x="90" y="52" width="110" height="18" rx="6" class="b-ink"/><text x="98" y="65">← №3116</text></g>
    <g class="flag"><circle cx="110" cy="48" r="9" class="clash-core"/></g></svg>`;
  if (id === 'deadline') return html`<svg viewBox="0 0 220 96" aria-hidden="true" class="art art-deadline">
    <text x="8" y="18" class="mut">Мойынты · 1 сутки</text><rect x="8" y="24" width="200" height="12" rx="6" class="track"/><rect x="8" y="24" width="200" height="12" rx="6" class="burn short"/>
    <text x="8" y="62" class="mut">Караганда · 4 суток</text><rect x="8" y="68" width="200" height="12" rx="6" class="track"/><rect x="8" y="68" width="200" height="12" rx="6" class="burn long"/></svg>`;
  return html`<svg viewBox="0 0 220 96" aria-hidden="true" class="art art-cap">
    ${Array.from({ length: 10 }, (_, k) => html`<rect key=${k} x=${8 + k * 20.5} y="30" width="17" height="30" rx="4" class=${`wag w${k}`}/>`)}
    <text x="8" y="84" class="mut">принять → обработать → убрать</text></svg>`;
}

export function Factors() {
  return html`<div class="factors">${FACTORS.map(f => html`<article class="factor" key=${f.id}>
    <${FactorArt} id=${f.id} />
    <div class="factor-body"><h3><${Icon} name=${f.icon} size=${17} />${f.title}</h3><p>${f.text}</p>
      <p class="affects"><span>Влияет на:</span> ${f.affects}</p><span class="formula">${f.fact}</span></div></article>`)}</div>`;
}
