import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { html, Icon } from '../lib.js';
import { AREAS, BY_ID, EQUIPMENT, LOGO } from './data.js';
import { operationAt } from './operations.js';
import { ASSEMBLY_STEPS, assemblyAt } from './assembly-state.js';
import { useProduction, ModelBar, LiveArea } from './model-bridge.js';

import { RealClock, MobileNav, readPreference, savePreference } from '../shell.js';

const readArea = () => { const id = location.hash.split('/')[2]; return BY_ID.has(id) ? id : null; };
function Control({ icon, label, onClick, active, children, disabled = false }) {
  return html`<button type="button" class=${`control ${active ? 'active' : ''}`} aria-label=${label} title=${label} onClick=${onClick} disabled=${disabled} aria-pressed=${active === undefined ? undefined : active}><${Icon} name=${icon} size=${18} />${children}</button>`;
}

function App() {
  const mount = useRef(null), engine = useRef(null), selectedRef = useRef(null);
  const [selected, setSelected] = useState(readArea), [interior, setInterior] = useState(()=>readPreference('factoryInterior',false));
  const [panel, setPanel] = useState('overview'), [ready, setReady] = useState(false), [error, setError] = useState(null);
  const [running, setRunning] = useState(() => !matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [seconds, setSeconds] = useState(0);
  const [labels, setLabels] = useState(true), [quality, setQuality] = useState(()=>!matchMedia('(max-width: 760px)').matches), [flow, setFlow] = useState(true);
  const [settings, setSettings] = useState(false), [help, setHelp] = useState(false), [fullscreen, setFullscreen] = useState(false);
  const [search, setSearch] = useState('');
  const [following, setFollowing] = useState(false);
  const [live,setLive]=useState(()=>new URLSearchParams(location.search).has('mode')?new URLSearchParams(location.search).get('mode')==='live':true);
  const production=useProduction(engine,ready,live);
  selectedRef.current = selected;
  useEffect(()=>{savePreference('factoryInterior',interior);},[interior]);
  useEffect(()=>{savePreference('factoryLive',live);savePreference('factoryRoute',`/?mode=${live?'live':'demo'}#/factory${selected?'/'+selected:''}`);},[live,selected]);
  const select = id => { setSelected(id); setPanel('overview'); location.hash = id ? `/factory/${id}` : '/factory'; };
  const home = () => { select(null); setInterior(false); engine.current?.home(); };
  useEffect(() => {
    let alive = true;
    import('./scene.js').then(({ mountFactory }) => {
      if (!alive) return;
      try {
        engine.current = mountFactory(mount.current, { onSelect: select, onReady: () => setReady(true), onError: setError, onTime: setSeconds, onFollowChange: setFollowing });
        if (selectedRef.current) engine.current.select(selectedRef.current, false);
      } catch (e) { setError('Не удалось запустить 3D. Проверьте, включено ли аппаратное ускорение браузера.'); console.error(e); }
    }).catch(e => { if (alive) setError('Не удалось загрузить сцену. Проверьте соединение и повторите.'); console.error(e); });
    return () => { alive = false; engine.current?.dispose(); };
  }, []);
  useEffect(() => { engine.current?.select(selected, interior, !following); }, [selected, interior, ready]);
  useEffect(() => { engine.current?.setRunning(running); }, [running, ready]);
  useEffect(() => { engine.current?.setLabels(labels); }, [labels, ready]);
  useEffect(() => { engine.current?.setQuality(quality); }, [quality, ready]);
  useEffect(() => { engine.current?.setFlow(flow); }, [flow, ready]);
  useEffect(() => {
    const route = () => setSelected(readArea());
    const key = e => {
      if (e.key === 'Escape') { setHelp(false); setSettings(false); }
      if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(document.activeElement?.tagName)) return;
      if (e.code === 'Space') { e.preventDefault(); if (!live) setRunning(value => !value); }
    };
    const full = () => setFullscreen(!!document.fullscreenElement);
    window.addEventListener('hashchange', route); window.addEventListener('keydown', key); document.addEventListener('fullscreenchange', full);
    return () => { window.removeEventListener('hashchange', route); window.removeEventListener('keydown', key); document.removeEventListener('fullscreenchange', full); };
  }, [live]);
  const area = BY_ID.get(selected);
  const operation = area ? operationAt(area.id, seconds) : null;
  const assembly = assemblyAt(seconds);
  const inspectStage = i => { setLive(false); select('assembly'); setInterior(true); setRunning(false); setFlow(true); engine.current?.inspectAssembly(i); };
  const followCar = () => { engine.current?.followAssembly(!following); };
  const fullScreen = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { setHelp(true); } };
  return html`<div class=${`factory-app ${live ? 'model-connected' : ''}`}>
    <header class="factory-header">
      <a class="allur-brand" href="#/factory" onClick=${home} aria-label="Allur — общий вид завода"><span class="logo-crop"><img src=${LOGO} alt="Allur" /></span><span class="brand-divider"></span><span class="brand-caption">DTAI<br/>ЦИФРОВОЙ ЗАВОД</span></a>
      <nav class="top-nav" aria-label="Разделы завода">
        <button class=${panel !== 'equipment' ? 'on' : ''} onClick=${() => { setPanel('overview'); setSearch(''); }}><${Icon} name="building-2" size=${17}/>Территория</button>
        <button class=${panel === 'equipment' ? 'on' : ''} onClick=${() => { setPanel('equipment'); setSearch(''); }}><${Icon} name="settings" size=${17}/>Оборудование</button>
        <a class="control-center-link" href="/control.html">Управление ↗</a><a class="control-center-link ai-nav-link" href="/ai.html">DTAI · агент ↗</a>
      </nav>
      <div class="header-end"><span class="location"><${Icon} name="map-pin" size=${15}/>Костанай, Казахстан</span><button class="help-button" aria-label="Как управлять сценой" onClick=${() => setHelp(!help)}><${Icon} name="circle-help" size=${19}/></button><span class="avatar" title="Демонстрационная модель">A</span></div>
    </header>
    <${ModelBar} live=${live} onChange=${setLive} production=${production}/>
    <div class="mobile-workshop-picker"><select aria-label="Участок завода" value=${selected||""} onChange=${e=>select(e.target.value||null)}><option value="">Весь завод</option>${AREAS.map(a=>html`<option value=${a.id}>${a.n} · ${a.short}</option>`)}</select><button onClick=${()=>document.querySelector(".factory-sidebar")?.scrollIntoView({behavior:"smooth"})}>Карточка ↓</button></div><div class="factory-body">
      <main class=${`factory-stage ${selected ? 'is-focused' : ''}`} aria-label="Территория завода">
        <div class="stage-heading"><div class="eyebrow"><span class="red-line"></span>ALLUR DIGITAL TWIN<span class="version-tag">01</span></div><h1>Производство Allur</h1><p>От комплектующих до готового автомобиля</p></div>
        <div class="view-switch" aria-label="Режим просмотра"><button class=${!interior ? 'on' : ''} onClick=${() => setInterior(false)} aria-pressed=${!interior}><${Icon} name="building-2" size=${15}/>Территория</button><button class=${interior ? 'on' : ''} onClick=${() => setInterior(true)} aria-pressed=${interior}><${Icon} name="layers" size=${15}/>Внутри цехов</button></div>
        <div class="factory-canvas" ref=${mount}></div>
        ${!ready && !error && html`<div class="scene-loading" role="status"><span class="spinner"></span><strong>Собираем завод</strong><span>Корпуса, оборудование и транспорт</span></div>`}
        ${error && html`<div class="scene-loading error" role="alert"><${Icon} name="circle-alert" size=${28}/><strong>3D-сцена недоступна</strong><p>${error}</p><button class="primary-button" onClick=${() => location.reload()}>Повторить загрузку</button></div>`}
        ${!live && selected === 'assembly' && interior && html`<div class="assembly-dock"><div class="assembly-dock-title"><span class="tracked-car-tag">A-01</span><span>Путь автомобиля<small>${assembly.moving ? (assembly.stage === 0 && assembly.phase < .12 ? 'Новый кузов на входе' : assembly.stage === 4 ? 'Передача на контроль' : 'Переход к следующему посту') : ASSEMBLY_STEPS[assembly.stage].title}</small></span><button class=${following ? 'following' : ''} aria-pressed=${following} onClick=${followCar}><${Icon} name=${following ? 'scan' : 'eye'} size=${15}/>${following ? 'Вся линия' : 'Следить за A-01'}</button></div><div class="assembly-stage-tabs" aria-label="Этапы сборки">${ASSEMBLY_STEPS.map((step, i) => html`<button key=${step.id} class=${i === assembly.stage ? 'active' : assembly.installed[i] ? 'complete' : ''} onClick=${() => inspectStage(i)} disabled=${!ready} aria-label=${`Рассмотреть этап: ${step.title}`} aria-pressed=${assembly.stage === i}><span>${assembly.installed[i] ? '✓' : `0${i + 1}`}</span>${step.short}</button>`)}</div></div>`}
        <div class="scene-legend"><span><i class="legend-dot red"></i>Производство</span><span><i class="legend-dot grey"></i>Инфраструктура</span><span class="scene-caption">Стилизованная модель</span></div>
        <div class="camera-toolbar" id="factory-controls">
          <${Control} icon="scan" label="Общий вид завода" onClick=${home} disabled=${!ready}/>
          <span class="toolbar-divider"></span>
          <${Control} icon="plus" label="Приблизить" onClick=${() => engine.current?.zoom(1)} disabled=${!ready}/>
          <${Control} icon="minus" label="Отдалить" onClick=${() => engine.current?.zoom(-1)} disabled=${!ready}/>
          <span class="toolbar-divider"></span>
          <${Control} icon="layers" label="Вид сверху" onClick=${() => engine.current?.top()} disabled=${!ready}/>
          <${Control} icon=${fullscreen ? 'minimize' : 'maximize'} label="Полный экран" onClick=${fullScreen}/>
          <${Control} icon="sliders-horizontal" label="Настройки отображения" active=${settings} onClick=${() => setSettings(!settings)}/>
        </div>
        ${settings && html`<div class="settings-popover"><strong>Отображение</strong><label><input type="checkbox" checked=${labels} onChange=${e => setLabels(e.target.checked)}/>Названия участков</label><label><input type="checkbox" checked=${quality} onChange=${e => setQuality(e.target.checked)}/>Тени и сглаживание</label><label><input type="checkbox" checked=${flow} onChange=${e => setFlow(e.target.checked)}/>Анимация процессов</label></div>`}
        <div class="compass" aria-hidden="true"><span>С</span><svg viewBox="0 0 40 40"><path d="M20 7 26 29 20 25 14 29Z" fill="#f4372b"/><circle cx="20" cy="20" r="18" fill="none" stroke="#cccfc8"/></svg></div>
      </main>
      <aside class="factory-sidebar" aria-label="Информация об участке">
        <div class="sidebar-breadcrumb">Завод Allur <span>/</span> ${panel === 'equipment' ? 'Оборудование' : area ? area.short : 'Обзор территории'}</div>
        <${LiveArea} state=${production.state} selected=${selected} live=${live}/>
        ${panel === 'equipment' ? html`<div class="side-content"><div class="panel-kicker">ОБЪЕКТЫ ИЗ КЕЙСА</div><h2>Оборудование</h2><p class="muted">Выберите объект, чтобы открыть его производственный участок.</p><label class="search-field"><${Icon} name="search" size=${17}/><input aria-label="Поиск оборудования" placeholder="Найти оборудование" value=${search} onInput=${e => setSearch(e.target.value)}/></label><div class="equipment-list">${EQUIPMENT.filter(e => `${e.id} ${e.name}`.toLowerCase().includes(search.toLowerCase())).map(e => html`<button key=${e.id} onClick=${() => { select(e.area); setInterior(true); }}><span class="equipment-icon"><${Icon} name="settings" size=${21}/></span><span><strong>${e.id}</strong><small>${e.name}</small><em>${e.detail}</em></span><${Icon} name="arrow-up-right" size=${15}/></button>`)}</div>${!EQUIPMENT.some(e => `${e.id} ${e.name}`.toLowerCase().includes(search.toLowerCase())) && html`<p class="empty-result">Оборудование не найдено</p>`}<div class="data-note"><${Icon} name="info" size=${16}/><span>Исторические события 1–2 октября 2026 года из задания Allur.</span></div></div>`
        : area ? html`<div class="side-content" key=${area.id}><div class="area-heading"><span class="area-number">${area.n}</span><span class="panel-kicker">ПРОИЗВОДСТВЕННЫЙ УЧАСТОК</span><button class="close-area" aria-label="Закрыть карточку участка" onClick=${home}><${Icon} name="x" size=${18}/></button></div><h2>${area.name}</h2><p class="muted">${area.description}</p>
          <button class="primary-button" onClick=${() => setInterior(!interior)}><${Icon} name="layers" size=${17}/>${interior ? 'Показать крышу' : 'Открыть цех'}<${Icon} name="arrow-up-right" size=${17}/></button>
          ${!live && (area.id === 'assembly' ? html`<div class="assembly-passport"><div class="passport-heading"><span class="tracked-car-tag">A-01</span><span>ДЕМОНСТРАЦИОННЫЙ АВТОМОБИЛЬ</span></div><div class="passport-progress"><strong>${assembly.count}<small> / 5</small></strong><span>этапов завершено</span><i class=${running && flow ? 'operation-dot playing' : 'operation-dot'}></i></div><div class="component-meter">${ASSEMBLY_STEPS.map((step, i) => html`<i key=${step.id} class=${assembly.installed[i] ? 'installed' : assembly.stage === i ? 'in-progress' : ''}></i>`)}</div><strong class="operation-current">${ASSEMBLY_STEPS[assembly.stage].title}</strong><p class="assembly-explanation">${ASSEMBLY_STEPS[assembly.stage].detail}</p><div class="assembly-parts">${ASSEMBLY_STEPS.map((step, i) => html`<button key=${step.id} onClick=${() => inspectStage(i)} disabled=${!ready} class=${assembly.stage === i ? 'current' : ''}><span class=${assembly.installed[i] ? 'part-check installed' : 'part-check'}>${assembly.installed[i] ? '✓' : `0${i + 1}`}</span><span>${step.title}<small>${assembly.installed[i] ? (i === 4 ? 'Завершено' : 'Установлено') : assembly.stage === i ? 'На рабочем посту' : 'Следующий этап'}</small></span><${Icon} name="arrow-up-right" size=${13}/></button>`)}</div><p class="assembly-hint">Выберите этап, чтобы рассмотреть его на паузе. ▶ продолжит сборку.</p></div>` : html`<div class="operation-card"><div class="operation-caption"><span class=${running && flow ? 'operation-dot playing' : 'operation-dot'}></span>${running && flow ? 'СЕЙЧАС В СЦЕНЕ' : 'АНИМАЦИЯ НА ПАУЗЕ'}<span>Цикл ${operation.duration} с</span></div><strong class="operation-current">${operation.label}</strong><div class="operation-track"><i style=${{ width: `${operation.phase * 100}%` }}></i></div><ol class="operation-steps">${operation.stages.map((stage, i) => html`<li key=${stage} class=${i === operation.index ? 'current' : i < operation.index ? 'done' : ''}><span>${String(i + 1).padStart(2, '0')}</span>${stage}</li>`)}</ol>${!interior && html`<button class="operation-open" onClick=${() => setInterior(true)}>Показать процесс внутри<${Icon} name="arrow-up-right" size=${14}/></button>`}<small>Иллюстрация технологической операции</small></div>`)}

          <div class="section-line"><h3>На участке</h3><span>${area.objects.length} объекта</span></div><ul class="object-list">${area.objects.map(object => html`<li key=${object}><span class="object-square"></span>${object}</li>`)}</ul>
          ${area.report ? html`<div class="case-report"><div class="section-line"><h3>Данные кейса</h3><span>02.10.2026</span></div><div class="report-output"><strong>${area.report.actual}<small> / ${area.report.plan}</small></strong><span>выпуск / план, ед.</span></div><div class="progress-track"><i style=${{ width: `${Math.min(100, area.report.actual / area.report.plan * 100)}%` }}></i></div><div class="report-grid"><div><strong>${area.report.load}%</strong><span>Загрузка</span></div><div><strong>${(area.report.defects / area.report.actual * 100).toFixed(1)}%</strong><span>Брак</span></div><div><strong>${area.report.hours.toLocaleString('ru-RU')} ч</strong><span>Время работы</span></div></div><p class="case-incident"><${Icon} name="clock" size=${14}/>${area.incident}</p></div>` : html`<div class="area-fact"><${Icon} name=${area.icon} size=${24}/><div><strong>${area.type}</strong><span>Участок производственной цепочки</span></div></div>`}
          ${area.next && html`<button class="next-area" onClick=${() => select(area.next)}><span>Следующий участок<strong>${BY_ID.get(area.next).name}</strong></span><${Icon} name="arrow-right" size=${19}/></button>`}
          <div class="data-note"><${Icon} name="info" size=${16}/><span>${live ? 'Положение оборудования показывает прогресс расчётного поста. Компоновка цеха и транспорт схематические. Исторические показатели PDF приведены отдельно.' : 'Движение в сцене — визуальная демонстрация. Показатели из PDF не изменяются анимацией.'}</span></div>
        </div>` : html`<div class="side-content"><div class="panel-kicker">ОБЗОР ТЕРРИТОРИИ</div><h2>Производство<br/>в деталях.</h2><p class="muted">Исследуйте завод, загляните внутрь цехов и проследите путь автомобиля.</p><div class="site-stats"><div><strong>06</strong><span>участков</span></div><div><strong>04</strong><span>объекта в кейсе</span></div></div><div class="section-line"><h3>Производственная цепочка</h3><${Icon} name="workflow" size=${17}/></div><div class="area-list">${AREAS.map(a => html`<button key=${a.id} onClick=${() => select(a.id)}><span class="list-number">${a.n}</span><span><strong>${a.name}</strong><small>${a.type}</small></span><${Icon} name="chevron-right" size=${16}/></button>`)}</div><button class="explore-button" onClick=${() => { select('assembly'); setInterior(true); }}>Заглянуть в цех сборки<${Icon} name="arrow-up-right" size=${19}/></button><div class="data-note"><${Icon} name="info" size=${16}/><span>Компоновка территории — иллюстрация производственной цепочки из кейса Allur.</span></div></div>`}
        <div class="sidebar-footer"><span class="small-logo">allur</span><span>СОЗДАВАЯ ДВИЖЕНИЕ</span></div>
      </aside>
    </div>
    <footer class="factory-timeline"><div class="playback">${!live&&html`<button class="play-button" aria-label=${running ? 'Приостановить движение' : 'Продолжить движение'} onClick=${() => setRunning(!running)} disabled=${!ready}><${Icon} name=${running ? 'pause' : 'play'} size=${16}/></button>`}<div class="model-clock"><${RealClock} serverTime=${production.state?.serverTime}/></div></div><div class="flow-steps" aria-label="Участки завода">${AREAS.map((a, i) => html`<div class="flow-step" key=${a.id}><button class=${selected === a.id ? 'selected' : ''} onClick=${() => select(a.id)} aria-label=${`Открыть ${a.name}`}><span>${a.n}</span>${a.short}</button>${i < AREAS.length - 1 && html`<${Icon} name="chevron-right" size=${13}/>`}</div>`)}</div><div class="scene-status"><i class=${running && flow ? 'running' : ''}></i>${live ? 'Состояние расчётной модели' : running && flow ? 'Сцена в движении' : 'Сцена на паузе'}</div></footer>
    <${MobileNav} active="factory"/>
    ${help && html`<div class="help-backdrop" onClick=${() => setHelp(false)}><section class="help-dialog" role="dialog" aria-modal="true" aria-label="Управление сценой" onClick=${e => e.stopPropagation()}><button class="close-area" aria-label="Закрыть справку" onClick=${() => setHelp(false)}><${Icon} name="x" size=${20}/></button><div class="panel-kicker">ALLUR DIGITAL TWIN</div><h2>Исследуйте завод</h2><p>Перетаскивайте сцену для вращения. Колесо мыши меняет масштаб, правая кнопка перемещает камеру.</p><p>На телефоне: один палец вращает, два — перемещают и меняют масштаб.</p><p>Выберите цех на сцене или в списке. «Внутри цехов» снимает крышу и показывает оборудование.</p><p><kbd>Пробел</kbd> — пауза. В фокусе сцены: <kbd>+</kbd> / <kbd>−</kbd> — масштаб, <kbd>Home</kbd> — общий вид.</p><button class="primary-button" onClick=${() => setHelp(false)}>Понятно, к заводу<${Icon} name="arrow-right" size=${17}/></button></section></div>`}
  </div>`;
}
const root = document.getElementById('root');
root.replaceChildren();
render(html`<${App}/>`, root);
