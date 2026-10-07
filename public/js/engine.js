// Тот же движок расчёта, что работает на сервере, запускается прямо в браузере — в песочнице.
// Ничего из этого не меняет общую смену на сервере.
let loading;
export function loadEngine() {
  loading ||= import('/engine/model.js');
  return loading;
}

/** Состояние-песочница: свежая смена с набором действий. */
export function makeState(engine, actions = []) {
  const state = engine.createState();
  for (const a of actions) engine.act(state, a);
  return state;
}

/** Снимок для отображения (как приходит с сервера). */
export function snap(engine, actions = []) {
  return engine.snapshot(makeState(engine, actions));
}

/** Проходы поездов по закрытому перегону: [{n, dir, priority, label, enter, exit}], по времени входа. */
export function crossings(data, seg = data.dispatch.closedSegment) {
  const out = [];
  for (const t of data.trains) {
    for (let k = 1; k < t.forecast.length; k++) {
      const [t0, i0] = t.forecast[k - 1], [t1, i1] = t.forecast[k];
      if (i0 !== i1 && Math.min(i0, i1) === seg) out.push({ n: t.number, dir: t.direction, priority: t.priority, label: t.label, enter: t0, exit: t1, delay: t.delay });
    }
  }
  return out.sort((a, b) => a.enter - b.enter || a.n - b.n);
}
