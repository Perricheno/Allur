import { useEffect, useState } from 'preact/hooks';
import { html, Icon } from './lib.js';
import { go } from './store.js';
import { Button, PageHeader } from './ui.js';
import { ProblemDemo, Factors, ModelFlow } from './how-problem.js';
import { AlgorithmStepper, Sandbox, Cases, StationLifecycle } from './how-engine.js';
import { MODEL_FACTORS, DISPLAY_ONLY_FACTORS, MISSING_FACTORS, FACTOR_AUDIT_DATE } from './model-factors.js';

const SECTIONS = [
  { id: 'problem', icon: 'siren', title: 'Проблема' },
  { id: 'model', icon: 'workflow', title: 'Цепочка решения' },
  { id: 'factors', icon: 'sliders-horizontal', title: 'Факторы' },
  { id: 'algorithm', icon: 'split', title: 'Как мы решаем' },
  { id: 'cases', icon: 'book-open', title: 'Примеры' },
  { id: 'sandbox', icon: 'flask-conical', title: 'Попробуйте сами' },
  { id: 'stations', icon: 'warehouse', title: 'Станции и вагоны' },
  { id: 'limits', icon: 'shield-check', title: 'Границы' },
];

function useScrollSpy(ids) {
  const [active, setActive] = useState(ids[0]);
  useEffect(() => {
    const io = new IntersectionObserver(entries => {
      const vis = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (vis) setActive(vis.target.id);
    }, { rootMargin: '-80px 0px -60% 0px' });
    ids.forEach(id => { const el = document.getElementById(id); if (el) io.observe(el); });
    return () => io.disconnect();
  }, []);
  return active;
}

const Section = ({ id, icon, eyebrow, title, lead, children }) => html`<section id=${id} class="how-section" aria-labelledby=${`${id}-t`}>
  <header><span class="eyebrow"><${Icon} name=${icon} size=${15} />${eyebrow}</span><h2 id=${`${id}-t`}>${title}</h2>${lead && html`<p class="lead">${lead}</p>`}</header>${children}</section>`;

export function HowPage() {
  const active = useScrollSpy(SECTIONS.map(s => s.id));
  const jump = (e, id) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  return html`<${PageHeader} title="Как это работает" subtitle="Задача, факторы, алгоритм и живые примеры. Всё на этой странице можно нажимать." actions=${html`<${Button} icon="file-down" onClick=${() => window.print()}>Экспортировать PDF</${Button}>`} />
    <div class="how-layout">
      <nav class="how-toc" aria-label="Разделы страницы"><ul>${SECTIONS.map(s => html`<li key=${s.id}><a href=${`#${s.id}`} class=${active === s.id ? 'on' : ''} aria-current=${active === s.id ? 'true' : undefined} onClick=${e => jump(e, s.id)}><${Icon} name=${s.icon} size=${16} />${s.title}</a></li>`)}</ul></nav>
      <div class="how-body">
        <section class="how-hero" aria-label="Коротко">
          <div><h2>Диспетчер видит график. Система видит последствия.</h2>
            <p>График движения составляется заранее, а жизнь вносит поправки: сход, закрытие пути, ремонт, ограничения скорости. Автодиспетчер в реальном времени находит конфликты, считает варианты и подсказывает лучший, а решение принимает человек.</p></div>
          <ul class="hero-facts">
            <li><${Icon} name="siren" size=${20} /><strong>Конфликты</strong><span>находит сам</span></li>
            <li><${Icon} name="split" size=${20} /><strong>3 варианта</strong><span>пропуска поездов</span></li>
            <li><${Icon} name="badge-check" size=${20} /><strong>Подтверждает</strong><span>только диспетчер</span></li>
            <li><${Icon} name="bell-ring" size=${20} /><strong>Пассажиры</strong><span>узнают сами</span></li>
          </ul>
        </section>

        <${Section} id="problem" icon="siren" eyebrow="Задача" title="Что происходит, когда путь закрыт"
          lead="Участок двухпутный: у каждого направления свой путь. Когда один путь выходит из строя, двум направлениям приходится делить оставшийся, и без правил очерёдности поезда начинают мешать друг другу.">
          <${ProblemDemo} /></${Section}>

        <${Section} id="model" icon="workflow" eyebrow="Логика" title="Как событие превращается в решение"
          lead="Это не чёрный ящик: показано, какие данные входят в расчёт, где возникают варианты и в какой момент решение возвращается диспетчеру.">
          <${ModelFlow} /></${Section}>

        <${Section} id="factors" icon="sliders-horizontal" eyebrow="Данные" title="Какие факторы учитывает система"
          lead=${`${MODEL_FACTORS.length} групп правил и расчётов, проверено по коду ${FACTOR_AUDIT_DATE}. Сначала шесть наглядных примеров участка, затем полный перечень по подсистемам.`}>
          <${Factors} />
          <div class="panel pad"><h3>Полный перечень факторов</h3><p>Область действия указана у каждого пункта. Правила детального участка нельзя автоматически переносить на все физические пути сети. Сетевой план назначений пока используется для прогноза, его автоматическое исполнение отключено.</p>
            <ol>${MODEL_FACTORS.map(([scope, name, description]) => html`<li key=${name}><strong>${scope} · ${name}.</strong> ${description}</li>`)}</ol>
            <h4>Паспортные показатели, не самостоятельные ограничения назначения</h4><ul>${DISPLAY_ONLY_FACTORS.map(x => html`<li>${x}</li>`)}</ul>
            <h4>Ещё не связаны с решениями в полном объёме</h4><ul>${MISSING_FACTORS.map(x => html`<li>${x}</li>`)}</ul>
          </div></${Section}>

        <${Section} id="algorithm" icon="split" eyebrow="Решение" title="Шесть шагов от события до уведомления"
          lead="Это тот же движок, что считает рабочий экран. Нажимайте на шаги или смотрите автоматически: диаграмма построена на реальных нитках из учебного графика.">
          <${AlgorithmStepper} /></${Section}>

        <${Section} id="cases" icon="book-open" eyebrow="Случаи" title="Три типовые ситуации"
          lead="Числа в примерах не придуманы: они посчитаны движком при открытии страницы.">
          <${Cases} /></${Section}>

        <${Section} id="sandbox" icon="flask-conical" eyebrow="Эксперимент" title="Песочница: закройте перегон сами"
          lead="Закрывайте путь, вводите ограничения скорости, выбирайте варианты и подтверждайте. Это локальная копия: рабочая смена не меняется.">
          <${Sandbox} /></${Section}>

        <${Section} id="stations" icon="warehouse" eyebrow="Станции" title="Подъездные пути и срок доставки"
          lead="Кроме движения поездов, система следит за ёмкостью путей станции и сроками доставки вагонов, чтобы не принять то, что не поместится, и не задержать то, что горит.">
          <${StationLifecycle} /></${Section}>

        <${Section} id="limits" icon="shield-check" eyebrow="Честно о границах" title="Что система делает, а что нет">
          <div class="limits">
            <div class="limit yes"><h3><${Icon} name="check-check" size=${18} />Делает</h3><ul>
              <li>Находит встречные конфликты на закрытом перегоне</li><li>Считает три варианта очерёдности и объясняет рекомендацию</li>
              <li>Пересчитывает прогноз после ограничения скорости</li><li>Автоматически готовит уведомления пассажирам</li><li>Следит за ёмкостью путей и сроками доставки вагонов</li></ul></div>
            <div class="limit no"><h3><${Icon} name="ban" size=${18} />Не делает</h3><ul>
              <li>Не управляет сигналами и стрелками и не заменяет СЦБ</li><li>Не моделирует интервальное регулирование и блок-участки</li>
              <li>Не учитывает локомотивные бригады и маневровые ресурсы</li><li>Не принимает решение за диспетчера</li><li>Использует учебные данные, а не реальную сеть</li></ul></div>
          </div>
          <div class="how-cta"><${Button} variant="primary" size="lg" iconRight="arrow-right" onClick=${() => go('/decisions')}>Перейти к работе с событиями</${Button}>
            <${Button} size="lg" icon="chart-gantt" onClick=${() => go('/overview?route=corridor')}>Открыть обстановку</${Button}></div>
        </${Section}>
      </div>
    </div>`;
}
