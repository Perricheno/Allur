// Характеристики поезда сети: маршрут, бригада, локомотив, состав, техсостояние.
import { html, Icon, time } from './lib.js';

const hm = min => `${Math.floor(min / 60)} ч ${String(min % 60).padStart(2, '0')} мин`;
const Fact = ({ icon, label, value, bad }) => html`<div class="fact"><${Icon} name=${icon} size=${16} /><span>${label}</span><strong class=${bad ? 'bad' : ''}>${value}</strong></div>`;

export function TrainSpecs({ t }) {
  const { crew, loco, consist: c } = t;
  const crewSoon = crew.leftMin < 45;
  return html`<div class="specs">
    <section aria-label="Маршрут"><h4>Маршрут</h4><div class="facts">
      <${Fact} icon="route" label="Маршрут" value=${`${t.from} → ${t.to}`} />
      <${Fact} icon="ruler" label="Пройдено" value=${`${Math.round(t.km)} из ${Math.round(t.totalKm)} км`} />
      <${Fact} icon="gauge" label="Скорость" value=${`${t.speedKmh} км/ч (допустимая ${loco.maxKmh})`} />
      <${Fact} icon="clock" label="Прибытие" value=${t.arrivesMs === null ? 'Ожидает назначения тяги' : `${time(t.arrivesMs)}${t.extraMin ? ` · задержка до ${Math.round(t.extraMin)} мин` : ''}`} /></div></section>
    <section aria-label="Бригада"><h4>Локомотивная бригада №${crew.number}</h4><div class="facts">
      <${Fact} icon="user-round" label="Состав бригады" value=${crew.size} />
      <${Fact} icon="timer" label="Отработано" value=${crew.assignmentPending ? 'Бригада ещё не назначена на отправление' : `${hm(crew.workedMin)} из ${hm(crew.limitMin)}`} />
      <${Fact} icon="hourglass" label="До смены" value=${crew.changing ? 'смена идёт сейчас' : hm(crew.leftMin)} bad=${crewSoon} />
      <${Fact} icon="map-pin" label="Смена на станции" value=${crew.nextChange} />
      <${Fact} icon="users" label="После смены" value=${crew.restReason} />
      <${Fact} icon="info" label="Почему меняется" value=${crew.changeReason} /></div></section>
    <section aria-label="Локомотив"><h4>Локомотив ${loco.series}</h4><div class="facts">
      <${Fact} icon="truck" label="Тип и мощность" value=${`${loco.type}, ${loco.kw.toLocaleString('ru-RU')} кВт`} />
      <${Fact} icon="weight" label="Масса локомотива" value=${`${loco.massT} т`} />
      <${Fact} icon=${loco.type === 'электровоз' ? 'zap' : 'fuel'} label=${loco.resource.label} value=${`${loco.resource.pct}%`} bad=${loco.type !== 'электровоз' && loco.resource.pct < 25} />
      <${Fact} icon="heart-pulse" label="Тех. состояние" value=${`${loco.conditionPct}%`} />
      <${Fact} icon="wrench" label="До ТО" value=${`${loco.toInH} ч из ${loco.toIntervalH} (прошло ${loco.sinceToH} ч)`} bad=${loco.toInH < 8} /></div></section>
    <section aria-label="Состав"><h4>Состав</h4><div class="facts">
      <${Fact} icon="package" label=${t.category === 'passenger' ? 'Вагонов' : 'Вагонов и груз'} value=${`${t.wagons} ваг.${t.cargo ? ` · ${t.cargo}, ${t.loaded ? 'гружёный' : 'порожний'}` : ''}`} />
      <${Fact} icon="weight" label="Масса брутто / нетто" value=${`${c.grossT.toLocaleString('ru-RU')} т / ${c.netT.toLocaleString('ru-RU')} т`} />
      <${Fact} icon="weight" label="Тара вагонов" value=${`${c.tareT.toLocaleString('ru-RU')} т`} />
      <${Fact} icon="weight" label="Осевая нагрузка" value=${`${c.axleLoadT} т/ось`} />
      <${Fact} icon="ruler" label="Длина поезда" value=${`${c.lengthM} м`} />
      <${Fact} icon="gauge" label=${t.category === 'passenger' ? 'Заполнение' : 'Загрузка'} value=${t.category === 'passenger' ? `${c.loadPct}% · ≈ ${Math.round(t.wagons * 52 * c.loadPct / 100)} пасс.` : t.loaded ? `${c.loadPct}%` : 'порожний'} />
      <${Fact} icon="shield-check" label="Тормоза" value=${`${c.braking}, опробованы за ${-c.brakeCheckMin} мин до отправления`} /></div></section>
  </div>`;
}
