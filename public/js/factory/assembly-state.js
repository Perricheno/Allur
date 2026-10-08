export const ASSEMBLY_STEPS = [
  { id: 'powertrain', title: 'Силовой узел', short: 'Двигатель', x: -17, detail: 'Подъёмник опускает силовой узел в подготовленный кузов.' },
  { id: 'interior', title: 'Салон и проводка', short: 'Салон', x: -8.5, detail: 'В кузов устанавливаются сиденья, приборная панель и рулевое колесо.' },
  { id: 'wheels', title: 'Колёса и тормоза', short: 'Колёса', x: 0, detail: 'Четыре колеса подаются с двух сторон и закрепляются на ступицах.' },
  { id: 'glazing', title: 'Двери и остекление', short: 'Двери', x: 8.5, detail: 'Устанавливаются двери и стёкла. Кузов приобретает законченный вид.' },
  { id: 'finish', title: 'Финальная сборка', short: 'Финиш', x: 17, detail: 'Закрываются панели кузова, появляются фары и бамперы. Автомобиль готов к проверке.' },
];
export const ASSEMBLY_TACT = 12;
export const ASSEMBLY_DURATION = ASSEMBLY_TACT * ASSEMBLY_STEPS.length;
export const ease = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };

export function assemblyAt(seconds, slot = 0) {
  const local = ((seconds + slot * ASSEMBLY_TACT) % ASSEMBLY_DURATION + ASSEMBLY_DURATION) % ASSEMBLY_DURATION;
  const stage = Math.floor(local / ASSEMBLY_TACT), phase = local / ASSEMBLY_TACT - stage;
  const install = ease((phase - .15) / .5);
  const step = ASSEMBLY_STEPS[stage];
  const outgoing = ease((phase - .8) / .2);
  const x = stage === 0 && phase < .12
    ? -23 + ease(phase / .12) * 6
    : step.x + outgoing * (stage === 4 ? 7 : 8.5);
  const installed = ASSEMBLY_STEPS.map((_, i) => stage > i || (stage === i && phase >= .65));
  return { stage, phase, install, x, installed, count: installed.filter(Boolean).length, moving: phase >= .8 || (stage === 0 && phase < .12) };
}
