import { FactoryModel } from './engine.js';

export const SCENARIOS = [
  { id: 'baseline', name: 'Без изменений', description: 'Продолжение текущего состояния', factors: {}, commands: [] },
  { id: 'paint-failure', name: 'Остановка окраски', description: 'Критическая остановка на 40 минут', factors: {}, commands: [{ type: 'failure', area: 'paint', minutes: 40 }] },
  { id: 'supplier-delay', name: 'Задержка поставок', description: 'Новые поставки приходят на 4 часа позже', factors: { 'logistics.deliveryDelayMinutes': 240 }, commands: [] },
  { id: 'staff-shortage', name: 'Нехватка сборщиков', description: 'На сборке присутствует 16 сотрудников', factors: { 'lines.assembly.staffAvailable': 16 }, commands: [] },
  { id: 'paint-environment', name: 'Ухудшение условий окраски', description: 'Жара, влажность и пыль увеличивают вероятность дефектов', factors: { 'environment.temperatureC': 35, 'environment.humidityPercent': 80, 'environment.dustFactor': 2.5 }, commands: [] },
  { id: 'power-limit', name: 'Ограничение мощности', description: 'Общий лимит мощности снижен до 500 кВт', factors: { 'utilities.powerLimitKw': 500 }, commands: [] },
  { id: 'maintenance', name: 'Обслуживание окраски', description: '20 минут обслуживания снижают износ и загрязнение фильтра', factors: {}, commands: [{ type: 'maintenance', area: 'paint', minutes: 20 }] },
  { id: 'extra-repair-crew', name: 'Дополнительные ремонтные бригады', description: 'Доступны четыре бригады', factors: { 'maintenance.crews': 4 }, commands: [] },
  { id: 'extra-rework', name: 'Расширение доработки', description: 'Четыре поста вместо двух', factors: { 'rework.bays': 4 }, commands: [] },
  { id: 'dispatch-stop', name: 'Нет автовозов', description: 'Склад заполняется и блокирует выпуск', factors: { 'logistics.dispatchEnabled': 0 }, commands: [] },
];

export function resolveScenarios(variants) {
  if (!Array.isArray(variants) || variants.length < 1 || variants.length > 6) throw new Error('Select 1..6 scenarios');
  const result = variants.map((value, index) => {
    if (typeof value === 'string') { const preset = SCENARIOS.find(s => s.id === value); if (!preset) throw new Error('Unknown scenario: ' + value); return structuredClone(preset); }
    if (!value || typeof value !== 'object' || !Array.isArray(value.commands || []) || (value.commands || []).length > 10) throw new Error('Invalid custom scenario');
    if ((value.commands || []).some(command => !['failure', 'maintenance', 'deliver', 'replenish_spares', 'schedule'].includes(command.type))) throw new Error('Unsupported scenario command');
    return { id: `custom-${index + 1}`, name: String(value.name || `Сценарий ${index + 1}`).slice(0, 100), factors: value.factors || {}, commands: value.commands || [] };
  }).filter(s => s.id !== 'baseline');
  return [structuredClone(SCENARIOS[0]), ...result];
}
const median = values => { const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; };
export function compareScenarios(state, { variants = ['paint-failure', 'extra-repair-crew'], horizonSeconds = 28800, seeds = [state.seed, (state.seed + 1) >>> 0, (state.seed + 2) >>> 0] } = {}) {
  if (!Number.isInteger(horizonSeconds) || horizonSeconds < 60 || horizonSeconds > 57600) throw new Error('Horizon must be 60..57600 seconds');
  if (!Array.isArray(seeds) || seeds.length < 1 || seeds.length > 5 || seeds.some(s => !Number.isInteger(s) || s < 0 || s > 4294967295) || new Set(seeds).size !== seeds.length) throw new Error('Provide 1..5 distinct uint32 seeds');
  const scenarios = resolveScenarios(variants), before = new FactoryModel({ state }).snapshot();
  const results = scenarios.map(scenario => {
    const runs = seeds.map(seed => {
      const model = new FactoryModel({ state }); model.s.seed = seed;
      model.action({ type: 'configure', factors: scenario.factors }, false);
      for (const command of scenario.commands) model.action(command, false);
      model.advance(horizonSeconds);
      const after = model.snapshot();
      const metrics = { downtimeMinutes: after.areas.reduce((total, a, i) => total + (a.stats.downSeconds - before.areas[i].stats.downSeconds) / 60, 0), produced: after.totals.produced - before.totals.produced, shipped: after.totals.shipped - before.totals.shipped, scrapped: after.totals.scrapped - before.totals.scrapped, rework: after.totals.reworkStarted - before.totals.reworkStarted, energyKwh: after.totals.energyKwh - before.totals.energyKwh, modeledCost: after.kpis.modeledCost - before.kpis.modeledCost, endingWip: after.kpis.wip, finishedStock: after.finishedStock.count };
      return { seed, metrics, bottleneck: after.bottleneck, balanced: after.conservation.balanced, areas: after.areas.map(a => ({ id: a.id, completed: a.stats.completed - before.areas.find(b => b.id === a.id).stats.completed, status: a.status, queue: a.queue.count, workingSeconds: a.stats.workingSeconds - before.areas.find(b => b.id === a.id).stats.workingSeconds, blockedSeconds: a.stats.blockedSeconds - before.areas.find(b => b.id === a.id).stats.blockedSeconds, starvedSeconds: a.stats.starvedSeconds - before.areas.find(b => b.id === a.id).stats.starvedSeconds })), risks: after.risks };
    });
    const summary = Object.fromEntries(Object.keys(runs[0].metrics).map(key => { const values = runs.map(run => run.metrics[key]); return [key, { median: median(values), min: Math.min(...values), max: Math.max(...values) }]; }));
    return { scenario, summary, runs };
  });
  const baseline = results[0];
  for (const item of results) {
    item.delta = Object.fromEntries(Object.keys(item.summary).map(key => {
      const differences = item.runs.map((run, i) => run.metrics[key] - baseline.runs[i].metrics[key]);
      return [key, { median: median(differences), min: Math.min(...differences), max: Math.max(...differences) }];
    }));
  }
  return { source: 'simulated_prediction', basedOnRevision: state.revision, fromElapsedSeconds: state.elapsed, horizonSeconds, seeds, results,
    uncertainty: { method: 'paired_seed_range', description: 'Медиана и диапазон по фиксированным seed. Это сценарный разброс, не статистический доверительный интервал и не гарантия фактического выпуска.' },
    limitations: ['Параметры не откалиброваны на телеметрии завода.', 'Сравнение выполняется из одной копии состояния; живой прогон не изменяется.', 'Расчётные затраты включают только заданные в модели статьи, не являются оценкой прибыли.'] };
}
