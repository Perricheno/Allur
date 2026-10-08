import { AREA_NAMES } from './config.js';

export function analyze(snapshot) {
  const { areas, inventory, totals, clock } = snapshot;
  const losses = areas.map(area => ({ area: area.id, name: area.name, minutes: {
    equipment: area.stats.downSeconds / 60, upstream: area.stats.starvedSeconds / 60,
    downstream: area.stats.blockedSeconds / 60, material: area.stats.materialSeconds / 60,
    setup: area.stats.changeoverSeconds / 60, staffing: area.stats.staffSeconds / 60, utilities: area.stats.powerSeconds / 60,
  } }));
  const recommendations = [];
  for (const area of areas) {
    if (area.status === 'down') recommendations.push({ area: area.id, priority: 'critical', title: `Восстановить участок «${area.name}»`, reason: area.reason === 'waiting_parts' ? 'Ремонт ожидает запасные части.' : area.reason === 'waiting_crew' ? 'Оборудование ожидает свободную ремонтную бригаду.' : 'Идёт ремонт критического оборудования.', evidence: { status: area.status, repair: area.condition.repair }, action: area.reason === 'waiting_parts' ? 'replenish_spares' : 'maintenance.crews' });
    if (area.status === 'material_shortage') recommendations.push({ area: area.id, priority: 'critical', title: 'Пополнить материалы', reason: `На участке «${area.name}» не хватает: ${area.reason}.`, evidence: { materials: area.reason }, action: 'deliver' });
    if (area.condition.filterLoad >= .7) recommendations.push({ area: area.id, priority: 'warning', title: 'Сравнить замену фильтра с продолжением работы', reason: 'Загрязнённость фильтра повышает риск дефекта и увеличивает цикл окраски.', evidence: { filterLoad: area.condition.filterLoad, defectProbability: area.condition.defectProbability }, scenario: 'maintenance' });
    if (area.condition.staffRatio < 1) recommendations.push({ area: area.id, priority: 'warning', title: 'Проверить комплектность смены', reason: 'Нехватка операторов ограничивает темп участка.', evidence: { staffRatio: area.condition.staffRatio, cycleSeconds: area.condition.effectiveCycleSeconds }, action: `lines.${area.id}.staffAvailable` });
  }
  const coverage = Object.entries(inventory).map(([material, stock]) => {
    const consumed = totals.materialConsumed[material] || 0;
    const hourlyConsumption = clock.elapsedSeconds > 0 ? consumed / (clock.elapsedSeconds / 3600) : 0;
    return { material, stock, hourlyConsumption, hoursRemaining: hourlyConsumption > 0 ? stock / hourlyConsumption : null, method: 'average_consumption_since_start' };
  });
  for (const item of coverage.filter(item => item.hoursRemaining !== null && item.hoursRemaining < 2)) recommendations.push({ area: 'supply', priority: 'warning', title: `Проверить поставку: ${item.material}`, reason: 'При среднем темпе текущего прогона запас закончится менее чем за два часа. Будущие поставки в этой оценке не учтены.', evidence: item, action: 'deliver' });
  const shifted = clock.shift || snapshot.configuration.calendar.shiftsPerDay;
  // Calendar boundaries are provided by the engine; never infer shift length from the wall clock.
  const start = snapshot.planning?.shiftStartElapsed ?? 0;
  return {
    source: 'rule_based_analysis', basedOnRevision: snapshot.revision,
    bottleneck: { ...snapshot.bottleneck, name: AREA_NAMES[snapshot.bottleneck.area] },
    losses, materialCoverage: coverage, recommendations,
    plan: { shift: shifted, start, produced: snapshot.planning?.shiftProduced ?? totals.produced, target: snapshot.kpis.currentShiftTarget },
    explanation: 'Рекомендации получены из явных правил по состоянию оборудования, ресурсам и запасам. Для оценки последствий запускайте сценарное сравнение.',
  };
}

export const DEMOS = [
  { id: 'cascade', name: 'Каскад остановки окраски', description: 'Прогон начинается после часа работы. Окраска останавливается на 60 минут: буфер перед ней растёт, сборка расходует задел.', expected: ['Остановка окраски', 'Заполнение входного накопителя', 'Голодание сборки'], factors: { 'maintenance.breakdownsEnabled': 0 }, warmupSeconds: 3600, command: { type: 'failure', area: 'paint', minutes: 60 } },
  { id: 'materials', name: 'Дефицит колёс и поставка', description: 'Запас колёс ограничен, автоматические поставки выключены. После остановки сборки добавьте 80 колёс и наблюдайте восстановление.', expected: ['Нехватка колёс', 'Остановка сборки', 'Восстановление после поставки'], factors: { 'maintenance.breakdownsEnabled': 0, 'inventory.wheels': 24, 'logistics.deliveryBatch': 0 }, warmupSeconds: 3600 },
  { id: 'quality', name: 'Качество окраски и обслуживание', description: 'Четыре часа работы с загрязнённым фильтром и высокой влажностью. Сравните обслуживание окраски с продолжением работы.', expected: ['Повышенный брак', 'Загрузка доработки', 'Сравнение обслуживания и базового варианта'], factors: { 'maintenance.breakdownsEnabled': 0, 'lines.paint.initialFilterLoad': .85, 'environment.humidityPercent': 75, 'environment.dustFactor': 2 }, warmupSeconds: 14400 },
];
