// Описание этапов модели: что получает, что считает и что выдаёт. Значения берутся из живой сводки runCycle().
// Это единственное место, где перечислены метрики этапов: страница строится по нему.
const row = (id, label, value, unit, hint, formula, extra = {}) => ({ id, label, value, unit, hint, formula, ...extra });

export const STAGES = [
  {
    id: 'input', title: 'Вход', caption: 'Что приходит', icon: 'radio',
    summary: s => `${s.trains} поездов`, ms: () => 0,
    rows: [
      row('trains', 'Поезда на линии', s => s.trains, 'поездов', 'Рейсы, которые сейчас в пути или на стоянке: берутся из расписания по времени модели.', 'рейс активен, если 0 ≤ t − отправление ≤ длительность рейса'),
      row('timetable', 'Расписание', (s, c) => c.dailyTrips, 'рейсов/сутки', 'Регулярные службы по 45 маршрутам: частота зависит от категории и веса маршрута.', 'рейсов = вес × коэффициент категории × min(1,3; км / 520)'),
      row('incidents', 'События диспетчера', s => s.incidents, 'активных', 'Закрытия путей, ограничения скорости и поломки поездов, которые задал диспетчер.', 'зона [a, b] км, окно [с, до], режим: закрыт / ограничение / поломка'),
      row('crews', 'Бригады на пределе', s => s.crewSoon, 'бригад', 'Локомотивные бригады, у которых до плановой смены осталось менее 45 минут.', 'осталось = предел 480 мин − отработано'),
      row('fleet', 'Локомотивы, ТО < 8 ч', s => s.toSoon, 'локомотивов', 'Локомотивы, у которых скоро срок технического обслуживания.', 'до ТО = интервал − наработка'),
      row('wagons', 'Вагонов в пути', s => s.wagons, 'вагонов', 'Суммарное число вагонов в составах на линии.', 'сумма по активным рейсам'),
      row('clock', 'Время модели', (s, c) => c.clock, '', 'Единое время модели. Положение каждого поезда зависит только от времени, поэтому сеть не сбрасывается.', 'позиция = f(t), без хранимого состояния', { numeric: false }),
    ],
  },
  {
    id: 'calc', title: 'Расчёт', caption: 'Что считает', icon: 'cpu',
    summary: s => `${(s.trainsMs + s.eventsMs + s.statsMs).toFixed(1)} мс`, ms: s => s.trainsMs + s.eventsMs + s.statsMs,
    rows: [
      row('profile', 'Профили и положения', s => s.trains, 'рейсов', 'Для рейса строится график остановок (стоянки, смена бригады, ожидания) и по нему вычисляется километр и скорость.', 'km(t) — кусочно-линейная функция по остановкам', { ms: s => s.trainsMs }),
      row('journal', 'Записи журнала', s => s.eventsHour, 'за час', 'Отправка, приём, смена бригады, пропуск, задержка, неисправность — собираются из профилей рейсов.', 'события берутся из профилей рейсов', { ms: s => s.eventsMs }),
      row('stats', 'Сводка сети', s => s.moving, 'в пути', 'Подсчёт движущихся и стоящих, средней скорости, локомотивов и вагонов.', 'агрегирование по рейсам', { ms: s => s.statsMs }),
      row('blocks', 'Занятые блок-участки', s => s.moving, 'участков', 'Каждый движущийся поезд занимает блок-участок: по занятости считаются светофоры.', 'красный — блок занят, жёлтый — следующий занят'),
      row('limits', 'Ограничения ресурса', s => s.crewSoon + s.toSoon, 'факторов', 'Работа бригад и срок ТО ограничивают рейс: смена назначается заранее.', 'смена, если отработано + стоянка + следующее плечо > предел'),
    ],
  },
  {
    id: 'judge', title: 'Оценка', caption: 'Что сравнивает', icon: 'scale',
    summary: s => `${s.forced} стоянок`, ms: s => s.variantsMs + s.decisionsMs,
    rows: [
      row('queue', 'Очередь у закрытий', s => s.queue, 'поездов', 'Поезда, которые доходят до закрытого участка и ждут очереди на единственный путь.', 'старт = max(подход, окно, интервал); встречный — после выхода', { ms: s => s.variantsMs }),
      row('variants', 'Варианты пропуска', s => s.variantsCount, 'расчётов', 'Для каждого события считаются три способа пропуска: очередь подхода, приоритет, пакетами.', 'вариантов = 3 × число событий'),
      row('weight', 'Лучшая потеря', s => s.bestLoss, 'вз. мин', 'Лучший вариант — с наименьшей взвешенной задержкой: пассажирские ×10, контейнерные ×2, грузовые ×1.', 'потеря = Σ (задержка × вес)'),
      row('conflicts', 'Вынужденные стоянки', s => s.forced, 'стоянок', 'Остановки вне расписания: пропуск, ожидание пути, неисправность.', 'вынужденная = остановка вне расписания', { ms: s => s.decisionsMs }),
      row('verdicts', 'Задержка оправдана', s => s.justified, 'из разобранных', 'Для каждой вынужденной стоянки модель сравнивает потери: держать поезд или отправить.', 'сравнение потерь: держать или отправить'),
    ],
  },
  {
    id: 'output', title: 'Результат', caption: 'Что получается', icon: 'check-check',
    summary: s => `${s.avgSpeed} км/ч`, ms: () => 0,
    rows: [
      row('positions', 'Средняя скорость', s => s.avgSpeed, 'км/ч', 'Поезда на схеме и карте: положение, направление, скорость.', 'средняя скорость по движущимся'),
      row('eta', 'Прогнозы прибытия', s => s.trains, 'прогнозов', 'Время прибытия каждого рейса с учётом стоянок и событий.', 'прибытие = отправление + длительность профиля + задержки'),
      row('decisions', 'Решения в журнале', s => s.eventsHour, 'за час', 'Решения модели записываются в журнал с типом и объяснением.', 'отправка, приём, смена бригады, пропуск, задержка'),
      row('notify', 'Пассажирам', s => s.passengerForced, 'задержано', 'Пассажирские поезда на вынужденной стоянке, о которых нужно сообщить.', 'уведомление при опоздании от 5 минут'),
      row('advice', 'Подсказки диспетчеру', s => s.recommendations, 'разборов', 'По каждой вынужденной стоянке модель считает, оправдана ли задержка.', 'сравнение потерь для каждой стоянки'),
      row('shorten', 'Можно сократить стоянку', s => s.shorten, 'стоянок', 'Стоянки, которые стоит сократить: потери от них больше, чем от отправки.', 'потеря держать > потеря отправить'),
    ],
  },
];

export const METRIC_CARDS = [
  { key: 'ms', label: 'Время цикла', unit: 'мс', digits: 1 }, { key: 'trains', label: 'Поездов на линии', unit: '' }, { key: 'moving', label: 'В пути', unit: '' },
  { key: 'forced', label: 'Вынужденные стоянки', unit: '' }, { key: 'avgSpeed', label: 'Средняя скорость', unit: 'км/ч' }, { key: 'eventsHour', label: 'Решений за час', unit: '' },
  { key: 'crewSoon', label: 'Бригад на пределе', unit: '' }, { key: 'toSoon', label: 'ТО менее 8 ч', unit: '' }, { key: 'queue', label: 'Очередь у закрытий', unit: '' },
  { key: 'recommendations', label: 'Подсказок диспетчеру', unit: '' }, { key: 'newInputs', label: 'Изменений входа за цикл', unit: '' }, { key: 'wagons', label: 'Вагонов в пути', unit: '' },
];

// Связи графа: из какой метрики в какую передаются данные (по идентификаторам строк).
export const LINKS = [
  ['trains', 'profile'], ['timetable', 'profile'], ['clock', 'profile'], ['trains', 'stats'], ['wagons', 'stats'], ['crews', 'limits'], ['fleet', 'limits'], ['incidents', 'blocks'], ['incidents', 'queue'],
  ['profile', 'conflicts'], ['profile', 'queue'], ['blocks', 'conflicts'], ['limits', 'conflicts'], ['limits', 'variants'], ['journal', 'verdicts'], ['stats', 'verdicts'],
  ['conflicts', 'decisions'], ['conflicts', 'notify'], ['conflicts', 'advice'], ['verdicts', 'advice'], ['verdicts', 'shorten'], ['weight', 'advice'], ['variants', 'eta'], ['queue', 'eta'], ['conflicts', 'eta'], ['stats', 'positions'], ['profile', 'eta'],
];

/**
 * Записей в секунду, которые узел отдаёт дальше. Одна точка на графе — одна запись:
 * по поезду на каждый рейс, по событию на каждое решение, по расчёту на каждый вариант.
 */
export const FLOW = {
  trains: s => s.trains, timetable: s => s.trains, incidents: s => s.incidents * 4, crews: s => s.trains, fleet: s => s.trains, wagons: s => s.trains, clock: () => 4,
  profile: s => s.trains, journal: s => Math.max(0.3, s.eventsHour / 3600), stats: s => s.trains, blocks: s => s.moving, limits: s => s.trains,
  queue: s => s.queue * 4, variants: s => s.variantsCount * 4, weight: s => s.variantsCount * 4, conflicts: s => s.forced * 4, verdicts: s => s.recommendations * 4,
  positions: s => s.moving, eta: s => s.trains, decisions: s => Math.max(0.3, s.eventsHour / 3600), notify: s => s.passengerForced * 4, advice: s => s.recommendations * 4, shorten: s => s.shorten * 4,
};

/** Скорость по каждой связи: поток узла делится поровну между его исходящими связями. */
export function linkRates(sample) {
  const out = new Map(), degree = new Map();
  for (const [a] of LINKS) degree.set(a, (degree.get(a) || 0) + 1);
  for (const [a, b] of LINKS) out.set(`${a}>${b}`, (FLOW[a]?.(sample) ?? 0) / degree.get(a));
  return out;
}
