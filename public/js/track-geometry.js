// Геометрия схемы пути (условные единицы; SVG масштабируется). Одно место для всех размеров и привязок.
export const MARGIN = 150, STEP = 300, H = 478, HALF = 42, CARGO_Y = 348;
export const Y_ODD = 188, Y_EVEN = 254;            // главные пути: сверху нечётный (←), снизу чётный (→)
export const TRAIN_W = 64, TRAIN_H = 22, ARROW = 12, WAGON_W = 12, WAGON_PITCH = 15;
export const SEG_LEN = STEP - 2 * HALF;            // длина перегона между границами станций
export const BLOCKS = 3;                           // блок-участков на перегон
export const stationX = i => MARGIN + i * STEP;
export const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];

export function hashStr(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}

/** Ряды светофоров: чётный стоит под своим путём, нечётный над своим. */
export const SIGNAL_ROW = { e: Y_EVEN + 30, o: Y_ODD - 30 };
export const TRACK_Y = { e: Y_EVEN, o: Y_ODD };

/**
 * Где стоит светофор в начале блок-участка b (счёт по ходу движения) на перегоне sgm.
 * b = 0 — выходной светофор станции, он рисуется станцией; промежуточные — на 1/3 и 2/3 перегона.
 */
export function blockSignalX(line, sgm, b) {
  const xs = stationX(sgm) + HALF;
  return line === 'e' ? xs + (SEG_LEN * b) / BLOCKS : xs + SEG_LEN - (SEG_LEN * b) / BLOCKS;
}

/** Светофоры на границах станции i: входной и выходной для каждого пути, снаружи станционной горловины. */
export function stationSignalSlots(i) {
  const x0 = stationX(i) - HALF - 12, x1 = stationX(i) + HALF + 12;
  return { eEntry: x0, eExit: x1, oEntry: x1, oExit: x0 };
}

/** Число вагонов, рисуемых за локомотивом, и длина состава на схеме. */
export const wagonCount = t => Math.min(8, Math.max(2, Math.round(t.wagons / 8)));
export const consistLength = t => TRAIN_W + ARROW + (t.network ? wagonCount(t) * WAGON_PITCH + 4 : 0);
