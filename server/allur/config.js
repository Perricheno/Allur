export const AREA_IDS = ['supply', 'welding', 'paint', 'assembly', 'quality', 'finished'];
export const MODEL_IDS = ['onix', 'cobalt', 'j7'];
export const MODEL_NAMES = { onix: 'Chevrolet Onix', cobalt: 'Chevrolet Cobalt', j7: 'JAC J7' };
export const AREA_NAMES = { supply: 'Склад комплектующих', welding: 'Сварка', paint: 'Окраска', assembly: 'Сборка', quality: 'Контроль качества', finished: 'Отгрузка' };
export const CASE_DATA = {
  source: 'provided_case_pdf', files: ['Кейс №2 Аллюр рус.pdf', 'Кейс_Цифровой_двойник_Тестовые_данные.pdf'],
  shiftsPerDay: 2, shiftHours: 8, targetOee: .85, maxDefectRate: .02, maxCriticalDowntimeMinutesPerDay: 60,
  monthlyTarget: 5500, modelPlans: { onix: 2500, cobalt: 1800, j7: 500 },
  records: [
    ['2026-10-01', 'welding', 120, 118, 7.8, 98, 2], ['2026-10-01', 'paint', 120, 115, 7.5, 94, 4], ['2026-10-01', 'assembly', 120, 121, 8, 100, 1],
    ['2026-10-02', 'welding', 120, 111, 7.2, 91, 3], ['2026-10-02', 'paint', 120, 116, 7.7, 96, 6], ['2026-10-02', 'assembly', 120, 119, 7.9, 99, 2],
  ].map(([date, area, plan, actual, operatingHours, reportedLoadPercent, defects]) => ({ date, area, plan, actual, operatingHours, reportedLoadPercent, defects, defectRate: defects / actual, oee: null })),
  incidents: [
    { date: '2026-10-01', area: 'welding', equipment: 'ABB-01', reason: 'Ошибка датчика', minutes: 25, kind: 'failure' },
    { date: '2026-10-01', area: 'paint', equipment: 'Камера-02', reason: 'Замена фильтра', minutes: 40, kind: 'maintenance_unspecified' },
    { date: '2026-10-02', area: 'assembly', equipment: 'Конвейер-03', reason: 'Обрыв цепи', minutes: 55, kind: 'failure' },
    { date: '2026-10-02', area: 'welding', equipment: 'ABB-04', reason: 'Плановое ТО', minutes: 30, kind: 'planned_maintenance' },
  ],
  limitations: [
    { code: 'PLAN_GAP', message: 'Планы по моделям дают 4800, общий целевой план — 5500. Назначение 700 автомобилей не указано.', value: 700 },
    { code: 'HISTORICAL_OEE_UNAVAILABLE', message: 'Идеальный такт, плановое время отчётного периода и календарь остановок не заданы. Исторический OEE не рассчитывается.' },
    { code: 'WIP_UNKNOWN', message: 'Начальные остатки и размеры накопителей неизвестны. Неравный выпуск переделов не доказывает конкретную причину.' },
    { code: 'NO_CAUSAL_LINK', message: 'Простой оборудования не приравнивается к простою линии; причинная связь в таблицах не задана.' },
    { code: 'NO_TRAINED_PREDICTION', message: 'Четырёх событий недостаточно для обучения прогнозу отказов. Прогнозы прототипа — результаты сценарной симуляции.' },
  ],
};

const spec = (label, value, min, max, unit = '', integer = false, source = 'assumption') => ({ label, default: value, min, max, unit, integer, source });
export const FACTORS = {
  'calendar.shiftsPerDay': spec('Смен в сутки', 2, 1, 3, 'смен', true, 'case'),
  'calendar.shiftHours': spec('Длительность смены', 8, 4, 12, 'ч', true, 'case'),
  'calendar.breakMinutes': spec('Плановые перерывы в смену', 30, 0, 90, 'мин', true),
  'calendar.workDaysPerMonth': spec('Рабочих дней в месяце', 22, 1, 31, 'дн', true),
  'plan.batchSize': spec('Размер производственной партии', 8, 1, 100, 'авто', true),
  'plan.monthlyTarget': spec('Месячная цель', 5500, 1, 30000, 'авто', true, 'case'),
  'utilities.powerLimitKw': spec('Лимит мощности', 1400, 0, 5000, 'кВт'),
  'utilities.gridAvailability': spec('Доступная доля питания', 1, 0, 1),
  'utilities.airPressureBar': spec('Давление сжатого воздуха', 6, 0, 10, 'бар'),
  'environment.temperatureC': spec('Температура в окраске', 23, 5, 45, '°C'),
  'environment.humidityPercent': spec('Влажность в окраске', 50, 10, 95, '%'),
  'environment.dustFactor': spec('Загрязнённость воздуха', 1, .1, 5),
  'labor.fatigueSensitivity': spec('Влияние усталости к концу смены', .08, 0, .4),
  'labor.hourlyCost': spec('Стоимость человеко-часа', 2500, 0, 30000, '₸/ч'),
  'logistics.deliveryEveryMinutes': spec('Интервал поставок', 240, 15, 1440, 'мин', true),
  'logistics.deliveryDelayMinutes': spec('Задержка поставки', 0, 0, 1440, 'мин', true),
  'logistics.deliveryReliability': spec('Вероятность доставки рейса', .98, 0, 1),
  'logistics.deliveryBatch': spec('Комплектов в поставке', 75, 0, 500, 'компл.', true),
  'logistics.dispatchEveryMinutes': spec('Интервал отправки автовозов', 30, 5, 480, 'мин', true),
  'logistics.carrierCapacity': spec('Мест на автовозе', 8, 1, 20, 'авто', true),
  'logistics.dispatchEnabled': spec('Доступность отгрузки', 1, 0, 1, '', true),
  'logistics.finishedCapacity': spec('Вместимость склада готовых машин', 40, 1, 500, 'авто', true),
  'maintenance.breakdownsEnabled': spec('Случайные отказы', 1, 0, 1, '', true),
  'maintenance.crews': spec('Ремонтных бригад', 2, 0, 10, 'бригад', true),
  'maintenance.sparesInitial': spec('Начальный запас ремонтных комплектов', 12, 0, 500, 'шт.', true),
  'maintenance.repairEfficiency': spec('Эффективность ремонтной бригады', 1, .25, 3),
  'rework.bays': spec('Постов доработки', 2, 0, 10, 'постов', true),
  'rework.capacity': spec('Вместимость зоны доработки', 12, 1, 100, 'авто', true),
  'rework.minutes': spec('Длительность доработки', 18, 1, 180, 'мин'),
  'rework.successRate': spec('Вероятность успешной доработки', .95, 0, 1),
  'quality.scrapShare': spec('Доля неисправимого брака', .08, 0, 1),
  'materials.paintLitersPerBody': spec('Расход покрытия на кузов', 6, 1, 30, 'л'),
  'cost.energyKwh': spec('Тариф электроэнергии', 38, 0, 500, '₸/кВт·ч'),
  'cost.reworkUnit': spec('Расходные материалы доработки', 12000, 0, 500000, '₸/авто'),
  'cost.scrapUnit': spec('Условная стоимость списания', 1600000, 0, 10000000, '₸/авто'),
};
const base = {
  supply: [150, 100, 8, 35, 0, 80], welding: [210, 175, 20, 240, 5 / 229, 40], paint: [225, 190, 16, 540, 10 / 231, 35],
  assembly: [210, 175, 32, 170, 3 / 240, 45], quality: [165, 130, 10, 70, .01, 70], finished: [100, 75, 6, 25, 0, 90],
};
for (const id of AREA_IDS) {
  const [cycle, ideal, staff, power, defect, mtbf] = base[id], prefix = `lines.${id}.`;
  Object.assign(FACTORS, Object.fromEntries(Object.entries({
    cycleSeconds: spec('Номинальный цикл', cycle, 30, 1800, 'с'), idealCycleSeconds: spec('Идеальный цикл', ideal, 10, 1800, 'с'),
    staffRequired: spec('Штат по нормативу', staff, 1, 100, 'чел.', true), staffAvailable: spec('Сотрудников на смене', staff, 0, 150, 'чел.', true),
    skill: spec('Квалификация персонала', 1, .3, 1.2), speed: spec('Режим скорости линии', 1, .3, 1.5),
    defectRate: spec('Базовая вероятность дефекта', defect, 0, .5, '', false, ['welding', 'paint', 'assembly'].includes(id) ? 'case_sample_estimate' : 'assumption'),
    mtbfHours: spec('Сценарная наработка между отказами', mtbf, .25, 100000, 'ч'), repairMinutes: spec('Сценарное время ремонта', 25, 1, 240, 'мин'),
    initialWear: spec('Начальный износ', .1, 0, 1), wearLifeHours: spec('Условный ресурс до предельного износа', 350, 10, 10000, 'ч'),
    powerKw: spec('Мощность при работе', power, 1, 2000, 'кВт'), bufferCapacity: spec('Входной накопитель', id === 'supply' ? 0 : 12, id === 'supply' ? 0 : 1, id === 'supply' ? 0 : 200, 'авто', true),
    changeoverMinutes: spec('Переналадка при смене модели', ['welding', 'paint', 'assembly'].includes(id) ? 1 : 0, 0, 60, 'мин'),
  }).map(([key, value]) => [prefix + key, { ...value, area: id }])));
}
FACTORS['lines.paint.initialFilterLoad'] = spec('Начальная загрязнённость фильтра', .15, 0, 1);
for (const [id, count] of Object.entries({ onix: 80, cobalt: 60, j7: 20, engines: 180, wheels: 720, batteries: 180, paintLiters: 1100 })) {
  FACTORS[`inventory.${id}`] = spec('Начальный запас: ' + (MODEL_NAMES[id] || id), count, 0, 100000, id === 'paintLiters' ? 'л' : 'шт.', true);
}
for (const [id, weight] of Object.entries({ onix: 2500, cobalt: 1800, j7: 500 })) FACTORS[`mix.${id}`] = spec(MODEL_NAMES[id] + ': вес в очереди', weight, 0, 30000, '', true, 'case_mix_assumption');
for (const id of AREA_IDS.slice(1)) FACTORS[`initialWip.${id}`] = spec('Начальный задел: ' + AREA_NAMES[id], ['welding', 'paint', 'assembly'].includes(id) ? 4 : id === 'quality' ? 2 : 0, 0, 200, 'авто', true);

export function setPath(object, path, value) { const parts = path.split('.'); const key = parts.pop(); let target = object; for (const part of parts) target = target[part] ||= {}; target[key] = value; }
export function getPath(object, path) { return path.split('.').reduce((o, key) => o?.[key], object); }
export function defaultConfig() { const config = {}; for (const [path, factor] of Object.entries(FACTORS)) setPath(config, path, factor.default); return config; }
export function patchConfig(current, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('factors must be an object of dotted paths');
  const next = structuredClone(current);
  for (const [path, value] of Object.entries(patch)) {
    const factor = Object.hasOwn(FACTORS, path) ? FACTORS[path] : null;
    if (!factor || typeof value !== 'number' || !Number.isFinite(value) || value < factor.min || value > factor.max || (factor.integer && !Number.isInteger(value))) throw new Error(`Invalid factor: ${path}`);
    setPath(next, path, value);
  }
  if (next.calendar.shiftHours * next.calendar.shiftsPerDay > 24) throw new Error('Shifts exceed 24 hours per day');
  if (MODEL_IDS.reduce((n, id) => n + next.mix[id], 0) === 0) throw new Error('Model mix cannot be empty');
  for (const id of AREA_IDS) {
    if (next.lines[id].idealCycleSeconds > next.lines[id].cycleSeconds) throw new Error(`Ideal cycle exceeds nominal: ${id}`);
    if (id !== 'supply' && next.initialWip[id] > next.lines[id].bufferCapacity) throw new Error(`Initial WIP exceeds capacity: ${id}`);
  }
  return next;
}
