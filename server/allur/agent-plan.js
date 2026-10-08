import { FactoryModel } from './engine.js';
import { FACTORS, AREA_IDS, getPath } from './config.js';

const object = properties => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
const array = items => ({ type: 'array', items });
export const SIMULATION_TOOL = {
  type: 'function', name: 'simulate_factory', strict: true,
  description: 'Запускает сравнительную симуляцию на копии текущего завода. Показывает ход расчёта и возвращает фактические метрики модели. Используй для вопросов «что если». Не меняет рабочий завод.',
  parameters: object({
    title: { type: 'string' }, hypothesis: { type: 'string' },
    horizonHours: { type: 'number', description: 'Горизонт от 1 до 16 часов. Если не указан, 8 часов и явно сообщи допущение.' },
    assumptions: array({ type: 'string' }),
    parameters: array(object({ key: { type: 'string', enum: Object.keys(FACTORS).filter(key => !/^(inventory\.|initialWip\.)|\.initial|sparesInitial/.test(key)) }, operation: { type: 'string', enum: ['set', 'add'] }, value: { type: 'number' } })),
    stops: array(object({ area: { type: 'string', enum: AREA_IDS }, afterMinutes: { type: 'number' }, durationMinutes: { type: 'number' }, kind: { type: 'string', enum: ['failure','maintenance'] } })),
    deliveries: array(object({ material: { type: 'string', enum: ['onix','cobalt','j7','engines','wheels','batteries','paintLiters'] }, quantity: { type: 'number' }, afterMinutes: { type: 'number' } })),
  }),
};
export function compilePlan(input, state) {
  if (!input || typeof input !== 'object') throw new Error('Не получен сценарий расчёта.');
  const { horizonHours, parameters, stops, deliveries } = input;
  if (!Number.isFinite(horizonHours) || horizonHours < 1 || horizonHours > 16) throw new Error('Горизонт сценария — от 1 до 16 часов.');
  if (![parameters,stops,deliveries,input.assumptions].every(Array.isArray) || parameters.length > 12 || stops.length > 6 || deliveries.length > 8 || input.assumptions.length > 10) throw new Error('Сценарий слишком большой.');
  const horizonSeconds = Math.round(horizonHours * 3600), factors = {}, commands = [], changes = [];
  for (const item of parameters) {
    const spec = FACTORS[item.key];
    if (!spec || /^(inventory\.|initialWip\.)|\.initial|sparesInitial/.test(item.key) || !['set','add'].includes(item.operation) || !Number.isFinite(item.value)) throw new Error('Недопустимый параметр сценария.');
    if (Object.hasOwn(factors,item.key)) throw new Error('Параметр указан дважды: ' + item.key);
    const before = getPath(state.config,item.key), after = item.operation === 'add' ? before + item.value : item.value;
    factors[item.key] = after; changes.push({ key:item.key, label:spec.label, area:spec.area || null, unit:spec.unit, before, after });
  }
  const validation = new FactoryModel({state}); validation.action({type:'configure',factors},false);
  const schedule = (command, minute) => {
    if (!Number.isFinite(minute) || minute < 0 || minute * 60 >= horizonSeconds) throw new Error('Время события должно попадать в горизонт расчёта.');
    const value = minute === 0 ? command : { type:'schedule', at:state.elapsed + Math.round(minute*60), command };
    validation.action(value,false); commands.push(value);
  };
  const occupied = new Set();
  for (const stop of stops) {
    if (!AREA_IDS.includes(stop.area) || occupied.has(stop.area) || !['failure','maintenance'].includes(stop.kind)) throw new Error('Укажите не более одной остановки на участок.');
    if (state.lines[stop.area].repair) throw new Error(`Участок ${stop.area} уже остановлен. Дождитесь восстановления или выберите другой участок.`);
    if (!Number.isFinite(stop.durationMinutes) || stop.durationMinutes < 1 || stop.durationMinutes > 240) throw new Error('Остановка может длиться от 1 до 240 минут.');
    occupied.add(stop.area); schedule({type:stop.kind,area:stop.area,minutes:stop.durationMinutes},stop.afterMinutes);
  }
  for (const delivery of deliveries) schedule({type:'deliver',materials:{[delivery.material]:delivery.quantity}},delivery.afterMinutes);
  if (!changes.length && !commands.length) throw new Error('В сценарии нет изменений. Уточните, что нужно проверить.');
  const scenario = { name: String(input.title || 'Сценарий DTAI').slice(0,120), factors, commands };
  return { title:scenario.name, hypothesis:String(input.hypothesis||'').slice(0,600), assumptions:input.assumptions.map(x=>String(x).slice(0,300)), changes, stops, deliveries, horizonSeconds, scenario,
    script: JSON.stringify({ engine:'Allur FactoryModel', basedOnRevision:state.revision, seed:state.seed, horizonSeconds, variants:[scenario] },null,2),
  };
}
