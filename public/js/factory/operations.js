import { ASSEMBLY_STEPS, ASSEMBLY_DURATION } from './assembly-state.js';
// These short loops illustrate operations; they do not calculate production KPIs.
export const OPERATIONS = {
  supply: { duration: 16, stages: ['Забор паллеты', 'Перевозка комплектующих', 'Размещение на складе', 'Возврат погрузчика'], ends: [.16, .5, .72, 1] },
  welding: { duration: 12, stages: ['Подача кузова', 'Фиксация кузова', 'Точечная сварка', 'Отвод манипуляторов'], ends: [.25, .35, .82, 1] },
  paint: { duration: 14, stages: ['Вход в камеру', 'Нанесение покрытия', 'Выдержка покрытия', 'Выход окрашенного кузова'], ends: [.22, .64, .78, 1] },
  assembly: { duration: ASSEMBLY_DURATION, stages: ASSEMBLY_STEPS.map(s => s.title), ends: [.2, .4, .6, .8, 1] },
  quality: { duration: 14, stages: ['Заезд на стенд', 'Проверка на роликах', 'Сканирование кузова', 'Выезд после проверки'], ends: [.2, .48, .8, 1] },
  finished: { duration: 18, stages: ['Подготовка к погрузке', 'Заезд на аппарель', 'Размещение на автовозе', 'Фиксация автомобиля'], ends: [.16, .5, .75, 1] },
};

export function operationAt(id, seconds) {
  const operation = OPERATIONS[id];
  const phase = ((seconds % operation.duration) + operation.duration) % operation.duration / operation.duration;
  const index = operation.ends.findIndex(end => phase < end);
  return { ...operation, phase, index, label: operation.stages[index] };
}
