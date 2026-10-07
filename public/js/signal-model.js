// Модель автоблокировки: аспекты светофоров по занятости блок-участков и закрытиям. Без зависимостей от интерфейса.
import { blockOccupancy } from './station-metrics.js';
import { BLOCKS, SIGNAL_ROW, TRACK_Y, blockSignalX } from './track-geometry.js';

/**
 * Модель сигнализации: занят ли блок и какой аспект у светофора в начале блока.
 * Блок b направления line ('e' чётное →, 'o' нечётное ←) считается по ходу движения.
 */
export function signalModel({ n, closures, tMin, live }) {
  const active = closures.filter(c => tMin >= c.from);
  const occupied = blockOccupancy(live);
  const closed = (line, sgm) => active.some(c => c.segment === sgm && (c.track === 'both' || (c.track === 'odd') === (line === 'o')) && c.track !== (line === 'o' ? 'even' : 'odd'));
  const busy = (line, sgm, b) => closed(line, sgm) || occupied.has(`${line}:${sgm}:${b}`);
  // следующий по ходу блок: тот же перегон или начало следующего
  const ahead = (line, sgm, b) => {
    if (b < BLOCKS - 1) return busy(line, sgm, b + 1);
    const next = line === 'e' ? sgm + 1 : sgm - 1;
    return next >= 0 && next < n - 1 && busy(line, next, 0);
  };
  const aspect = (line, sgm, b) => (busy(line, sgm, b) ? 'red' : ahead(line, sgm, b) ? 'yellow' : 'green');
  const blocks = [];
  for (let sgm = 0; sgm < n - 1; sgm++) {
    for (let b = 1; b < BLOCKS; b++) {
      for (const line of ['e', 'o']) {
        blocks.push({ key: `${line}${sgm}${b}`, x: blockSignalX(line, sgm, b), y: SIGNAL_ROW[line], trackY: TRACK_Y[line], aspect: aspect(line, sgm, b),
          label: `Блок-сигнал, ${line === 'e' ? 'чётный' : 'нечётный'} путь` });
      }
    }
  }
  // светофоры у станции i: выходной = начало блока 0, входной показывает занятость подходного блока
  const station = i => ({
    eEntry: i > 0 ? (busy('e', i - 1, BLOCKS - 1) ? 'red' : 'green') : null, eExit: i < n - 1 ? aspect('e', i, 0) : null,
    oEntry: i < n - 1 ? (busy('o', i, BLOCKS - 1) ? 'red' : 'green') : null, oExit: i > 0 ? aspect('o', i - 1, 0) : null,
  });
  return { blocks, station, busy };
}
