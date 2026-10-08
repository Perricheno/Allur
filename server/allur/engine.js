import { AREA_IDS, MODEL_IDS, AREA_NAMES, MODEL_NAMES, CASE_DATA, defaultConfig, patchConfig } from './config.js';

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const ratio = (a, b) => b > 0 ? a / b : null;
const START = Date.parse('2026-10-02T08:00:00+05:00');
const COMPLEXITY = { onix: 1, cobalt: .95, j7: 1.18 };
export const EQUIPMENT = { supply: ['FORK-01'], welding: ['ABB-01', 'ABB-04'], paint: ['Камера-02'], assembly: ['Конвейер-03'], quality: ['QC-01'], finished: ['CARRIER-01'] };
// Counter-based random draws keep runs reproducible and comparable across scenarios.
function random(seed, ...keys) {
  let h = seed >>> 0;
  for (const char of keys.join('|')) { h ^= char.charCodeAt(0); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function lineStats() { return { plannedSeconds: 0, workingSeconds: 0, downSeconds: 0, starvedSeconds: 0, blockedSeconds: 0, materialSeconds: 0, changeoverSeconds: 0, staffSeconds: 0, powerSeconds: 0, completed: 0, firstPassGood: 0, defects: 0, idealSeconds: 0, failures: 0, repaired: 0, repairSeconds: 0, energyKwh: 0 }; }
function modelStats() { return Object.fromEntries(MODEL_IDS.map(id => [id, { started: 0, initial: 0, produced: 0, shipped: 0, scrapped: 0 }])); }

export class FactoryModel {
  constructor({ seed = 4817, factors = {}, state = null } = {}) {
    if (state) { this.s = structuredClone(state); if (this.s.schemaVersion !== 1) throw new Error('Unsupported snapshot version'); return; }
    if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw new Error('Seed must be uint32');
    const config = patchConfig(defaultConfig(), factors);
    this.s = {
      schemaVersion: 1, seed, config, elapsed: 0, running: true, speed: 1, revision: 0, sequence: 0, eventSequence: 0,
      inventory: structuredClone(config.inventory), spares: config.maintenance.sparesInitial,
      lines: Object.fromEntries(AREA_IDS.map(id => [id, { id, status: 'idle', reason: null, queue: [], job: null, repair: null, lastModel: null, changeoverRemaining: 0, wear: config.lines[id].initialWear, filterLoad: id === 'paint' ? config.lines.paint.initialFilterLoad : 0, stats: lineStats(), dailyDowntime: 0, downtimeDay: 0 }])),
      goods: [], rework: [], inTransit: [], utilities: { demandKw: 0, powerScale: 1, consumedKw: 0 }, nextDeliveryAt: config.logistics.deliveryEveryMinutes * 60, nextDispatchAt: config.logistics.dispatchEveryMinutes * 60,
      totals: { started: 0, initialWip: 0, produced: 0, shipped: 0, scrapped: 0, defectiveUnits: 0, reworkStarted: 0, reworkRecovered: 0, firstPassProduced: 0, energyKwh: 0, laborCost: 0, reworkCost: 0, scrapCost: 0, leadTimeSeconds: 0, leadTimeCount: 0, materialConsumed: {}, materialReceived: {} },
      models: modelStats(), events: [], incidents: [], history: [], audit: [], scheduled: [],
    };
    for (const id of AREA_IDS.slice(1)) for (let i = 0; i < config.initialWip[id]; i++) {
      const model = MODEL_IDS[i % MODEL_IDS.length], unit = this.unit(model, true);
      this.s.lines[id].queue.push(unit);
    }
    this.event('model_started', null, 'Запущена имитационная модель. Параметры, не заданные кейсом, являются допущениями.');
    this.sample();
  }
  exportState() { return structuredClone(this.s); }
  clone() { return new FactoryModel({ state: this.s }); }
  event(type, area, message, detail = {}) {
    this.s.events.push({ id: ++this.s.eventSequence, at: this.s.elapsed, type, area, message, source: 'simulation', ...detail });
    if (this.s.events.length > 300) this.s.events.shift();
  }
  unit(model, initial = false) {
    const unit = { id: `A-${String(++this.s.sequence).padStart(6, '0')}`, model, createdAt: this.s.elapsed, initial, reworked: false, route: [] };
    this.s.models[model][initial ? 'initial' : 'started']++;
    this.s.totals[initial ? 'initialWip' : 'started']++;
    return unit;
  }
  chooseModel() {
    const c = this.s.config, total = MODEL_IDS.reduce((n, id) => n + c.mix[id], 0), count = this.s.totals.started + 1;
    const previous = this.s.lines.supply.lastModel;
    if (previous && c.mix[previous] > 0 && this.s.totals.started % c.plan.batchSize !== 0) return previous;
    return MODEL_IDS.filter(id => c.mix[id] > 0).sort((a, b) => (count * c.mix[b] / total - this.s.models[b].started) - (count * c.mix[a] / total - this.s.models[a].started))[0];
  }
  calendar() {
    const c = this.s.config.calendar, relative = this.s.elapsed % 86400, shiftSeconds = c.shiftHours * 3600;
    const shiftIndex = Math.floor(relative / shiftSeconds), within = relative % shiftSeconds;
    const active = shiftIndex < c.shiftsPerDay;
    const breakSeconds = c.breakMinutes * 60, middle = shiftSeconds / 2;
    const onBreak = active && within >= middle - breakSeconds / 2 && within < middle + breakSeconds / 2;
    return { active, onBreak, shift: active ? shiftIndex + 1 : null, shiftProgress: within / shiftSeconds, day: Math.floor(this.s.elapsed / 86400) + 1 };
  }
  conditions(id, model = 'onix') {
    const s = this.s, c = s.config, line = s.lines[id], cfg = c.lines[id], shift = this.calendar();
    const staff = Math.min(1, cfg.staffAvailable / cfg.staffRequired);
    const fatigue = 1 - c.labor.fatigueSensitivity * Math.max(0, shift.shiftProgress - .5) * 2;
    const air = ['welding', 'paint', 'assembly'].includes(id) ? (c.utilities.airPressureBar < 3 ? 0 : clamp(c.utilities.airPressureBar / 6, 0, 1)) : 1;
    const filter = id === 'paint' ? 1 - .3 * line.filterLoad : 1;
    const capacity = staff * cfg.skill * cfg.speed * fatigue * air * filter * (1 - .2 * line.wear);
    const nominal = cfg.cycleSeconds * COMPLEXITY[model];
    const ideal = cfg.idealCycleSeconds * COMPLEXITY[model];
    const cycleSeconds = capacity > 0 ? Math.max(ideal, nominal / capacity) : null;
    let qualityMultiplier = 1 + 1.5 * line.wear + Math.max(0, 1 - cfg.skill) * 2 + Math.max(0, cfg.speed - 1) * 2 + (1 - fatigue) * 2;
    if (id === 'paint') qualityMultiplier *= 1 + Math.abs(c.environment.temperatureC - 23) * .04 + Math.abs(c.environment.humidityPercent - 50) * .012 + line.filterLoad * 1.5 + Math.max(0, c.environment.dustFactor - 1) * .3;
    return { staffRatio: staff, fatigue, airRatio: air, filterEfficiency: filter, cycleSeconds, idealSeconds: ideal, defectProbability: clamp(cfg.defectRate * qualityMultiplier, 0, .8), capacityPerHour: cycleSeconds ? 3600 / cycleSeconds : 0 };
  }
  consume(requirements) {
    if (Object.entries(requirements).some(([key, n]) => this.s.inventory[key] + 1e-9 < n)) return false;
    for (const [key, n] of Object.entries(requirements)) { this.s.inventory[key] = Math.max(0, this.s.inventory[key] - n); this.s.totals.materialConsumed[key] = (this.s.totals.materialConsumed[key] || 0) + n; }
    return true;
  }
  receive(materials) {
    for (const [key, n] of Object.entries(materials)) { this.s.inventory[key] += n; this.s.totals.materialReceived[key] = (this.s.totals.materialReceived[key] || 0) + n; }
  }
  shipping() {
    const s = this.s, c = s.config;
    if (s.elapsed >= s.nextDeliveryAt) {
      const batch = c.logistics.deliveryBatch, sum = MODEL_IDS.reduce((n, id) => n + c.mix[id], 0);
      const kits = Object.fromEntries(MODEL_IDS.map(id => [id, Math.floor(batch * c.mix[id] / sum)]));
      kits[MODEL_IDS.find(id => c.mix[id] > 0)] += batch - Object.values(kits).reduce((a, b) => a + b, 0);
      const delivered = random(s.seed, 'delivery', s.nextDeliveryAt) < c.logistics.deliveryReliability;
      if (delivered) s.inTransit.push({ id: `D-${s.nextDeliveryAt}`, arrivalAt: s.elapsed + c.logistics.deliveryDelayMinutes * 60, materials: { ...kits, engines: batch, batteries: batch, wheels: batch * 4, paintLiters: batch * c.materials.paintLitersPerBody } });
      else this.event('delivery_missed', 'supply', 'Поставщик пропустил рейс', { batch });
      s.nextDeliveryAt = s.elapsed + c.logistics.deliveryEveryMinutes * 60;
    }
    for (const shipment of s.inTransit.filter(item => item.arrivalAt <= s.elapsed)) { this.receive(shipment.materials); this.event('delivery_received', 'supply', 'Получены комплектующие', { shipmentId: shipment.id, materials: shipment.materials }); }
    s.inTransit = s.inTransit.filter(item => item.arrivalAt > s.elapsed);
    if (s.elapsed >= s.nextDispatchAt) {
      if (c.logistics.dispatchEnabled) {
        const shipped = s.goods.splice(0, c.logistics.carrierCapacity);
        for (const unit of shipped) { s.totals.shipped++; s.models[unit.model].shipped++; }
        if (shipped.length) this.event('shipment_departed', 'finished', 'Автовоз отправлен', { count: shipped.length, units: shipped.map(u => u.id) });
      }
      s.nextDispatchAt = s.elapsed + c.logistics.dispatchEveryMinutes * 60;
    }
  }
  incident(area, minutes, kind = 'failure', equipment = null) {
    const line = this.s.lines[area];
    if (!line || line.repair) throw new Error('Unknown area or equipment already stopped');
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 240) throw new Error('Duration must be 1..240 minutes');
    if (equipment && !EQUIPMENT[area].includes(equipment)) throw new Error('Equipment does not belong to area');
    const item = { id: `I-${this.s.eventSequence + 1}`, area, equipment: equipment || EQUIPMENT[area][0], kind, at: this.s.elapsed, endedAt: null, plannedMinutes: minutes, state: 'waiting_crew', repairSeconds: 0 };
    this.s.incidents.push(item); if (this.s.incidents.length > 200) this.s.incidents = this.s.incidents.filter(i => !i.endedAt).concat(this.s.incidents.filter(i => i.endedAt).slice(-100));
    line.repair = { incidentId: item.id, remaining: minutes * 60, active: false, kind };
    line.status = 'down'; line.reason = item.state;
    if (kind === 'failure') line.stats.failures++;
    this.event(kind, area, kind === 'maintenance' ? 'Начато плановое обслуживание' : 'Остановка критического оборудования', { incidentId: item.id, equipment: item.equipment, minutes });
  }
  repairs() {
    const s = this.s, c = s.config;
    let occupied = AREA_IDS.filter(id => s.lines[id].repair?.active).length;
    const repairOrder = AREA_IDS.filter(id => s.lines[id].repair).sort((a, b) => s.incidents.find(i => i.id === s.lines[a].repair.incidentId).at - s.incidents.find(i => i.id === s.lines[b].repair.incidentId).at);
    for (const id of repairOrder) {
      const line = s.lines[id], repair = line.repair; if (!repair) continue;
      const incident = s.incidents.find(i => i.id === repair.incidentId);
      if (!repair.active && occupied < c.maintenance.crews && (repair.kind === 'maintenance' || s.spares > 0)) {
        repair.active = true; occupied++; if (repair.kind === 'failure') s.spares--; incident.state = 'repairing';
      }
      if (!repair.active) { incident.state = s.spares <= 0 && repair.kind === 'failure' ? 'waiting_parts' : 'waiting_crew'; continue; }
      repair.remaining -= c.maintenance.repairEfficiency; incident.repairSeconds++; line.stats.repairSeconds++;
      if (repair.remaining <= 0) {
        incident.endedAt = s.elapsed; incident.state = 'resolved'; line.repair = null; occupied--; line.stats.repaired++;
        line.wear *= repair.kind === 'maintenance' ? .25 : .6;
        if (id === 'paint') line.filterLoad = repair.kind === 'maintenance' ? .05 : line.filterLoad * .7;
        this.event('equipment_restored', id, 'Оборудование восстановлено', { incidentId: incident.id, downtimeSeconds: s.elapsed - incident.at });
      }
    }
  }
  scrap(unit, area) { this.s.totals.scrapped++; this.s.models[unit.model].scrapped++; this.s.totals.scrapCost += this.s.config.cost.scrapUnit; this.event('unit_scrapped', area, 'Автомобиль списан', { unitId: unit.id, model: unit.model }); }
  destination(area, unit) {
    const index = AREA_IDS.indexOf(area);
    if (index < AREA_IDS.length - 1) {
      const next = this.s.lines[AREA_IDS[index + 1]];
      if (next.queue.length >= this.s.config.lines[next.id].bufferCapacity) return false;
      next.queue.push(unit); return true;
    }
    if (this.s.goods.length >= this.s.config.logistics.finishedCapacity) return false;
    this.s.goods.push(unit); this.s.totals.produced++; this.s.models[unit.model].produced++;
    if (!unit.reworked) this.s.totals.firstPassProduced++;
    if (!unit.initial) { this.s.totals.leadTimeSeconds += this.s.elapsed - unit.createdAt; this.s.totals.leadTimeCount++; }
    this.event('vehicle_ready', area, 'Автомобиль готов к отгрузке', { unitId: unit.id, model: unit.model, reworked: unit.reworked });
    return true;
  }
  processRework(active) {
    const s = this.s, c = s.config; let occupied = 0;
    for (const item of s.rework) {
      if (!item.ready && active && occupied < c.rework.bays) { occupied++; item.remaining--; if (item.remaining <= 0) item.ready = true; }
      if (!item.ready) continue;
      if (!item.result) item.result = random(s.seed, 'rework', item.unit.id, item.area) < c.rework.successRate ? 'good' : 'scrap';
      if (item.result === 'scrap') { this.scrap(item.unit, item.area); item.done = true; }
      else if (this.destination(item.area, item.unit)) { s.totals.reworkRecovered++; item.done = true; this.event('rework_completed', item.area, 'Автомобиль возвращён после доработки', { unitId: item.unit.id }); }
    }
    s.rework = s.rework.filter(item => !item.done);
  }
  finishJob(line) {
    const job = line.job, s = this.s, c = s.config;
    if (job.outcome === 'scrap') { this.scrap(job.unit, line.id); line.job = null; return true; }
    if (job.outcome === 'rework') {
      if (s.rework.length >= c.rework.capacity) return false;
      job.unit.reworked = true;
      s.rework.push({ unit: job.unit, area: line.id, remaining: c.rework.minutes * 60, ready: false });
      s.totals.reworkStarted++; s.totals.reworkCost += c.cost.reworkUnit;
      this.event('quality_deviation', line.id, 'Автомобиль направлен на доработку', { unitId: job.unit.id }); line.job = null; return true;
    }
    if (!this.destination(line.id, job.unit)) return false;
    line.job = null; return true;
  }
  workLine(id, shift, powerScale) {
    const s = this.s, c = s.config, line = s.lines[id], cfg = c.lines[id];
    const status = (value, reason = null) => { line.status = value; line.reason = reason; };
    if (!shift.active || shift.onBreak) { status(shift.onBreak ? 'break' : 'off_shift'); return; }
    line.stats.plannedSeconds++;
    if (line.repair) { line.stats.downSeconds++; line.dailyDowntime++; status('down', s.incidents.find(i => i.id === line.repair.incidentId)?.state); return; }
    const cond = this.conditions(id, line.job?.unit.model);
    if (!cfg.staffAvailable) { line.stats.staffSeconds++; status('no_staff', 'Нет операторов'); return; }
    if (powerScale <= 0 || (['welding', 'paint', 'assembly'].includes(id) && c.utilities.airPressureBar < 3)) { line.stats.powerSeconds++; status('no_utilities', powerScale <= 0 ? 'Нет питания' : 'Недостаточно сжатого воздуха'); return; }
    if (line.job?.progress >= 1) {
      if (!this.finishJob(line)) { line.stats.blockedSeconds++; status('blocked', line.job.outcome === 'rework' ? 'Зона доработки заполнена' : 'Выходной накопитель заполнен'); return; }
    }
    if (!line.job) {
      const unit = line.queue[0], model = id === 'supply' ? this.chooseModel() : unit?.model;
      if (!model) { line.stats.starvedSeconds++; status('starved', 'Нет входящих автомобилей'); return; }
      if (line.lastModel && line.lastModel !== model && line.changeoverFor !== model && cfg.changeoverMinutes > 0) {
        line.changeoverRemaining = cfg.changeoverMinutes * 60; line.changeoverFor = model;
      }
      if (line.changeoverRemaining > 0) { line.changeoverRemaining--; line.stats.changeoverSeconds++; status('changeover', `Переналадка: ${MODEL_NAMES[model]}`); return; }
      const requirements = id === 'supply' ? { [model]: 1 } : id === 'paint' ? { paintLiters: c.materials.paintLitersPerBody } : id === 'assembly' ? { engines: 1, batteries: 1, wheels: 4 } : {};
      if (!this.consume(requirements)) { line.stats.materialSeconds++; status('material_shortage', Object.keys(requirements).filter(key => s.inventory[key] < requirements[key]).join(', ')); return; }
      line.job = { unit: id === 'supply' ? this.unit(model) : line.queue.shift(), progress: 0, startedAt: s.elapsed, outcome: null };
      line.lastModel = model; line.changeoverFor = null;
    }
    const failureRate = (1 + line.wear * 3 + Math.max(0, cfg.speed - 1) * 2) / (cfg.mtbfHours * 3600);
    if (c.maintenance.breakdownsEnabled && random(s.seed, 'failure', id, s.elapsed) < failureRate) {
      this.incident(id, clamp(cfg.repairMinutes * (.75 + random(s.seed, 'repair', id, s.elapsed) * .5), 1, 240));
      line.stats.downSeconds++; line.dailyDowntime++; status('down', 'waiting_crew'); return;
    }
    const actual = this.conditions(id, line.job.unit.model);
    line.job.progress = Math.min(1, line.job.progress + powerScale / actual.cycleSeconds);
    line.stats.workingSeconds++; line.wear = Math.min(1, line.wear + 1 / (cfg.wearLifeHours * 3600));
    status('working', powerScale < .999 ? 'Ограничение мощности' : actual.staffRatio < 1 ? 'Неполный состав смены' : null);
    if (line.job.progress >= 1) {
      const job = line.job; line.stats.completed++; line.stats.idealSeconds += actual.idealSeconds;
      const defect = random(s.seed, 'quality', id, job.unit.id) < actual.defectProbability;
      if (defect) { if (!job.unit.hadDefect) { s.totals.defectiveUnits++; job.unit.hadDefect = true; } line.stats.defects++; job.outcome = random(s.seed, 'scrap', id, job.unit.id) < c.quality.scrapShare ? 'scrap' : 'rework'; }
      else { line.stats.firstPassGood++; job.outcome = 'good'; }
      job.unit.route.push({ area: id, enteredAt: job.startedAt, completedAt: s.elapsed, outcome: job.outcome });
      if (id === 'paint') line.filterLoad = Math.min(1, line.filterLoad + .0025 * c.environment.dustFactor);
      // Completed units remain on the post until the downstream buffer has space.
      this.finishJob(line);
    }
  }
  advance(seconds) {
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > 86400) throw new Error('Advance must be 0..86400 integer seconds');
    for (let i = 0; i < seconds; i++) {
      const s = this.s, c = s.config; s.elapsed++;
      const shift = this.calendar();
      for (const line of Object.values(s.lines)) if (line.downtimeDay !== shift.day) { line.downtimeDay = shift.day; line.dailyDowntime = 0; }
      this.shipping(); this.repairs();
      const due = s.scheduled.filter(action => action.at <= s.elapsed); s.scheduled = s.scheduled.filter(action => action.at > s.elapsed);
      for (const action of due) { try { this.action(action.command, false); } catch (error) { this.event('scheduled_action_rejected', null, error.message); } }
      this.processRework(shift.active && !shift.onBreak && c.utilities.gridAvailability > 0 && c.utilities.powerLimitKw > 0);
      const demand = AREA_IDS.reduce((n, id) => {
        const line = s.lines[id], couldWork = shift.active && !shift.onBreak && !line.repair && c.lines[id].staffAvailable > 0 && (line.job || line.queue.length || (id === 'supply' && s.inventory[this.chooseModel()] > 0));
        return n + c.lines[id].powerKw * (couldWork ? 1 : .08);
      }, 0);
      const powerScale = Math.min(c.utilities.gridAvailability, c.utilities.powerLimitKw / Math.max(demand, 1));
      s.utilities = { demandKw: shift.active ? demand : 0, powerScale, consumedKw: 0 };
      for (const id of [...AREA_IDS].reverse()) this.workLine(id, shift, powerScale);
      for (const id of AREA_IDS) {
        const line = s.lines[id], busy = line.status === 'working';
        const energy = shift.active ? c.lines[id].powerKw * (busy ? 1 : .08) * powerScale / 3600 : 0;
        line.stats.energyKwh += energy; s.totals.energyKwh += energy;
        s.utilities.consumedKw += energy * 3600;
        if (shift.active) s.totals.laborCost += c.lines[id].staffAvailable * c.labor.hourlyCost / 3600;
      }
      if (s.elapsed % 300 === 0) this.sample();
    }
    if (seconds) this.s.revision++;
    return this;
  }
  setFactors(patch) {
    if (Object.keys(patch || {}).some(path => /^(inventory\.|initialWip\.)|\.initial|sparesInitial/.test(path))) throw new Error('Initial conditions require reset; use deliver or replenish_spares for live inventory');
    const next = patchConfig(this.s.config, patch);
    for (const id of AREA_IDS) if (this.s.lines[id].queue.length > next.lines[id].bufferCapacity) throw new Error(`Capacity below current occupancy: ${id}`);
    if (this.s.goods.length > next.logistics.finishedCapacity || this.s.rework.length > next.rework.capacity) throw new Error('Capacity below current occupancy');
    if (AREA_IDS.filter(id => this.s.lines[id].repair?.active).length > next.maintenance.crews) throw new Error('Cannot remove busy repair crews');
    this.s.config = next;
    if (Object.hasOwn(patch, 'logistics.deliveryEveryMinutes')) this.s.nextDeliveryAt = this.s.elapsed + next.logistics.deliveryEveryMinutes * 60;
    if (Object.hasOwn(patch, 'logistics.dispatchEveryMinutes')) this.s.nextDispatchAt = this.s.elapsed + next.logistics.dispatchEveryMinutes * 60;
  }
  action(command, audit = true) {
    if (!command || typeof command !== 'object') throw new Error('Command object required');
    const { type } = command;
    switch (type) {
      case 'acknowledge': {
        const incident = this.s.incidents.find(item => item.id === command.incidentId);
        if (!incident) throw new Error('Unknown incident');
        incident.acknowledgedAt = this.s.elapsed; incident.note = String(command.note || '').slice(0, 300);
        this.event('incident_acknowledged', incident.area, 'Инцидент принят в работу', { incidentId: incident.id }); break;
      }
      case 'play': this.s.running = true; break;
      case 'pause': this.s.running = false; break;
      case 'speed': if (![1, 10, 30, 60, 120, 300, 600].includes(command.value)) throw new Error('Unsupported speed'); this.s.speed = command.value; break;
      case 'configure': this.setFactors(command.factors); this.event('factors_changed', null, 'Изменены параметры модели', { factors: command.factors }); break;
      case 'failure': case 'maintenance': this.incident(command.area, command.minutes ?? this.s.config.lines[command.area]?.repairMinutes, type, command.equipment); break;
      case 'deliver': {
        const entries = Object.entries(command.materials || {});
        if (!entries.length || entries.some(([key, value]) => !Object.hasOwn(this.s.inventory, key) || !Number.isFinite(value) || value < 0 || value > 100000 || (key !== 'paintLiters' && !Number.isInteger(value)))) throw new Error('Invalid material delivery');
        this.receive(command.materials); this.event('manual_delivery', 'supply', 'Добавлена поставка материалов', { materials: command.materials }); break;
      }
      case 'replenish_spares': if (!Number.isInteger(command.count) || command.count < 1 || command.count > 500) throw new Error('Invalid spare count'); this.s.spares += command.count; break;
      case 'schedule': {
        if (!Number.isInteger(command.at) || command.at <= this.s.elapsed || command.at > this.s.elapsed + 86400 || !['failure', 'maintenance', 'configure', 'deliver', 'replenish_spares'].includes(command.command?.type)) throw new Error('Invalid scheduled command');
        const probe = this.clone(); probe.action(command.command, false);
        if (this.s.scheduled.length >= 100) throw new Error('Too many scheduled commands');
        this.s.scheduled.push({ at: command.at, command: structuredClone(command.command) }); break;
      }
      default: throw new Error('Unknown command: ' + type);
    }
    if (audit) { this.s.audit.push({ at: this.s.elapsed, command: structuredClone(command) }); if (this.s.audit.length > 200) this.s.audit.shift(); }
    this.s.revision++;
    return this;
  }
  sample() {
    const s = this.s;
    s.history.push({ at: s.elapsed, produced: s.totals.produced, shipped: s.totals.shipped, scrapped: s.totals.scrapped, energyKwh: s.totals.energyKwh, buffers: Object.fromEntries(AREA_IDS.map(id => [id, s.lines[id].queue.length])), statuses: Object.fromEntries(AREA_IDS.map(id => [id, s.lines[id].status])) });
    if (s.history.length > 2016) s.history.shift();
  }
  conservation() {
    const s = this.s, active = AREA_IDS.reduce((n, id) => n + s.lines[id].queue.length + (s.lines[id].job ? 1 : 0), 0) + s.rework.length;
    const entered = s.totals.initialWip + s.totals.started, accounted = active + s.goods.length + s.totals.shipped + s.totals.scrapped;
    return { entered, active, finishedStock: s.goods.length, shipped: s.totals.shipped, scrapped: s.totals.scrapped, accounted, balanced: entered === accounted };
  }
  snapshot() {
    const s = this.s, c = s.config, shift = this.calendar(), balance = this.conservation();
    const areas = AREA_IDS.map(id => {
      const line = s.lines[id], stats = line.stats, baseCondition = this.conditions(id, line.job?.unit.model), powerScale = s.utilities.powerScale;
      const condition = { ...baseCondition, powerScale, effectiveCycleSeconds: powerScale && baseCondition.cycleSeconds ? baseCondition.cycleSeconds / powerScale : null, capacityPerHour: line.repair ? 0 : baseCondition.capacityPerHour * powerScale };
      const availability = ratio(stats.workingSeconds, stats.plannedSeconds), performance = ratio(stats.idealSeconds, stats.workingSeconds), quality = ratio(stats.firstPassGood, stats.completed);
      return { id, name: AREA_NAMES[id], status: line.status, reason: line.reason, source: 'simulation', equipmentIds: EQUIPMENT[id], queue: { count: line.queue.length, capacity: c.lines[id].bufferCapacity, unitIds: line.queue.map(u => u.id) }, job: line.job ? { unit: line.job.unit, progress: line.job.progress, startedAt: line.job.startedAt, outcome: line.job.outcome } : null,
        stats: structuredClone(stats), metrics: { availability, performance, quality, oee: availability === null || performance === null || quality === null ? null : availability * performance * quality, utilization: ratio(stats.workingSeconds, stats.plannedSeconds), defectRate: ratio(stats.defects, stats.completed), reportedHistoricalLoad: null },
        condition: { ...condition, wear: line.wear, filterLoad: line.filterLoad, repair: line.repair, dailyDowntimeSeconds: line.dailyDowntime, temperatureC: c.environment.temperatureC + (line.status === 'working' ? 5 : 0) + line.wear * 8, vibrationMmS: 1.2 + line.wear * 5 + (line.status === 'working' ? .4 : 0), sensorSource: 'synthetic' },
      };
    });
    const bottleneck = areas.filter(a => !['supply', 'finished'].includes(a.id)).sort((a, b) => a.condition.capacityPerHour - b.condition.capacityPerHour)[0];
    const risks = [];
    for (const area of areas) {
      if (area.status === 'down') risks.push({ code: 'EQUIPMENT_STOPPED', area: area.id, severity: 'critical', evidence: area.condition.repair, message: 'Критическое оборудование остановлено; участок ожидает завершения ремонта.' });
      if (area.status === 'no_utilities' || area.status === 'no_staff') risks.push({ code: 'RESOURCE_SHORTAGE', area: area.id, severity: 'critical', evidence: area.reason, message: area.reason });
      if (area.queue.capacity && area.queue.count / area.queue.capacity >= .8) risks.push({ code: 'BUFFER_FULL', area: area.id, severity: 'warning', evidence: area.queue, message: 'Накопитель близок к заполнению; возможна блокировка предыдущего участка.' });
      if (area.status === 'material_shortage') risks.push({ code: 'MATERIAL_SHORTAGE', area: area.id, severity: 'critical', evidence: area.reason, message: 'Работа остановлена из-за нехватки материалов.' });
      if (area.condition.dailyDowntimeSeconds > 3600) risks.push({ code: 'DOWNTIME_LIMIT', area: area.id, severity: 'critical', evidence: area.condition.dailyDowntimeSeconds, message: 'Превышен порог простоя 60 минут за модельные сутки.' });
      if (area.stats.completed >= 30 && area.metrics.defectRate > CASE_DATA.maxDefectRate) risks.push({ code: 'DEFECT_LIMIT', area: area.id, severity: 'warning', evidence: { defects: area.stats.defects, inspected: area.stats.completed, rate: area.metrics.defectRate }, message: 'Доля дефектов выше 2%.' });
      if (area.condition.wear >= .7 || area.condition.filterLoad >= .75) risks.push({ code: 'MAINTENANCE_DUE', area: area.id, severity: 'warning', evidence: { wear: area.condition.wear, filterLoad: area.condition.filterLoad }, message: 'Повышенный износ или загрязнение фильтра; сравните сценарий обслуживания.' });
    }
    const hours = s.elapsed / 3600, cost = s.totals.laborCost + s.totals.energyKwh * c.cost.energyKwh + s.totals.reworkCost + s.totals.scrapCost;
    const shiftDuration = c.calendar.shiftHours * 3600;
    const dayStart = Math.floor(s.elapsed / 86400) * 86400;
    const shiftStartElapsed = dayStart + ((shift.shift || c.calendar.shiftsPerDay) - 1) * shiftDuration;
    const shiftBaseline = [...s.history].reverse().find(point => point.at <= shiftStartElapsed);
    return { schemaVersion: 1, source: 'simulation', revision: s.revision, seed: s.seed,
      clock: { elapsedSeconds: s.elapsed, iso: new Date(START + s.elapsed * 1000).toISOString(), timezone: 'Asia/Almaty', running: s.running, speed: s.speed, ...shift },
      configuration: structuredClone(c), planning: { shiftStartElapsed, shiftProduced: s.totals.produced - (shiftBaseline?.produced || 0), shiftShipped: s.totals.shipped - (shiftBaseline?.shipped || 0), shiftTarget: c.plan.monthlyTarget / c.calendar.workDaysPerMonth / c.calendar.shiftsPerDay },
      areas, units: [...AREA_IDS.filter(id => s.lines[id].job).map(id => ({ ...s.lines[id].job.unit, area: id, state: s.lines[id].status, progress: s.lines[id].job.progress })), ...AREA_IDS.flatMap(id => s.lines[id].queue.map(unit => ({ ...unit, area: id, state: 'queued' }))), ...s.rework.map(item => ({ ...item.unit, area: item.area, state: 'rework' })), ...s.goods.map(unit => ({ ...unit, area: 'finished', state: 'ready' }))],
      inventory: structuredClone(s.inventory), utilities: structuredClone(s.utilities), spares: s.spares, inTransit: structuredClone(s.inTransit), rework: { count: s.rework.length, capacity: c.rework.capacity, bays: c.rework.bays },
      finishedStock: { count: s.goods.length, capacity: c.logistics.finishedCapacity, nextDispatchAt: s.nextDispatchAt },
      totals: structuredClone(s.totals), models: structuredClone(s.models), conservation: balance,
      kpis: { completed: s.totals.produced, shipped: s.totals.shipped, wip: balance.active, throughputPerElapsedHour: ratio(s.totals.produced, hours), firstPassYield: ratio(s.totals.firstPassProduced, s.totals.produced + s.totals.scrapped), averageLeadTimeSeconds: ratio(s.totals.leadTimeSeconds, s.totals.leadTimeCount), energyPerVehicleKwh: ratio(s.totals.energyKwh, s.totals.produced), modeledCost: cost, modeledCostPerVehicle: ratio(cost, s.totals.produced), monthlyTarget: c.plan.monthlyTarget, dailyTarget: c.plan.monthlyTarget / c.calendar.workDaysPerMonth, currentShiftTarget: c.plan.monthlyTarget / c.calendar.workDaysPerMonth / c.calendar.shiftsPerDay, costScope: 'Illustrative energy, labor, rework and scrap only; not full unit cost', factoryOee: null },
      bottleneck: { area: bottleneck.id, capacityPerHour: bottleneck.condition.capacityPerHour, method: 'minimum_current_effective_capacity', explanation: 'Оценка по текущим тактам и ресурсам; влияние очередей и остановок проверяется сценарным прогоном.' },
      risks, events: structuredClone(s.events.slice(-80)), incidents: structuredClone(s.incidents), history: structuredClone(s.history), scheduled: structuredClone(s.scheduled),
      assumptions: ['Компоновка и ресурсы — параметры прототипа, не измерения завода.', 'Один последовательный агрегированный пост на участок; критическая поломка останавливает весь этот пост.', 'Автомобили учитываются поштучно. Технологические циклы, начальный задел, ремонт и поставки заданы сценарно.', 'Годный выпуск считается при поступлении на склад готовых машин; отгрузка учитывается отдельно.', 'OEE рассчитывается отдельно по участкам: работа / плановое время × идеальное время / работа × годные с первого раза / обработанные.', 'Плановые перерывы исключены из знаменателя доступности. Общезаводской OEE не усредняется из разных переделов.', 'Экономические параметры являются допущениями; стоимость автомобиля целиком не рассчитывается.'],
    };
  }
}
