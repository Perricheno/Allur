import { test, expect } from '@playwright/test';

const api = async (request, data) => (await request.post('/api/action', { data })).json();
const getState = async request => (await request.get('/api/state')).json();
const minutesNow = s => (s.now - s.baseTime) / 60000;
/** Поезд на линии, у которого впереди ещё не меньше часа пути и нет ТО. */
const runningTrain = s => s.trains.find(t => t.forecast[0][0] <= minutesNow(s) && t.forecast.at(-1)[0] > minutesNow(s) + 60 && !t.service && t.forecast.every(([, i]) => Number.isInteger(i)));
async function advanceUntil(request, predicate, maxSteps = 24, minutes = 60) {
  for (let i = 0; i < maxSteps; i++) { const s = await getState(request); if (predicate(s)) return s; await api(request, { type: 'advance', minutes }); }
  return getState(request);
}
/** Поезд, который прямо сейчас вынужденно стоит на станции (не плановая стоянка). */
const waitingNow = s => s.trains.some(t => t.forecast.some(([t1, i], k) => {
  const [t0, i0] = t.forecast[k - 1] || [];
  return k && i === i0 && Number.isInteger(i) && t0 <= minutesNow(s) && minutesNow(s) <= t1 && !t.route.some((p, j) => j && p[1] === i && t.route[j - 1][1] === i);
}));

test.beforeEach(async ({ request }) => {
  await request.post('/api/action', { data: { type: 'reset' } });
});

test('overview shows KPIs, the Gantt chart and the attention card', async ({ page }) => {
  await page.goto('/#/overview?route=corridor');
  await expect(page.getByRole('heading', { name: 'Оперативная обстановка' })).toBeVisible();
  await expect(page.getByText('Движение по графику').first()).toBeVisible();
  await expect(page.getByRole('img', { name: /График движения: \d+ поездов/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Требует решения' })).toBeVisible();
  await expect(page.locator('.kpi', { hasText: 'Загрузка участка' })).toBeVisible();
  await expect(page.locator('.kpi', { hasText: 'ТО и поломки' })).toBeVisible();
  await expect(page.locator('.minimap')).toBeVisible();
});

async function closeSegment(page, segment, track, minutes = '0') {
  await page.getByLabel('Перегон для закрытия').selectOption(String(segment));
  await page.getByLabel('Какой путь закрыть').selectOption(track);
  await page.getByLabel('Длительность закрытия').selectOption(minutes);
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
}

test('closure: conflicts, three variants, choosing and confirming a plan notifies passengers', async ({ page }) => {
  await page.goto('/#/decisions');
  await closeSegment(page, 3, 'odd');
  await expect(page.locator('.closure-list')).toContainText('перегон D–E: нечётный путь');
  const variants = page.getByRole('radiogroup', { name: 'Варианты пропуска поездов' }).locator('label.variant');
  await expect(variants).toHaveCount(3);
  await expect(variants.filter({ hasText: 'Рекомендуется' })).toHaveCount(1);
  await variants.nth(2).click();
  await expect(variants.nth(2)).toHaveClass(/on/);
  await expect(page.locator('.notices li')).toHaveCount(0);       // до подтверждения пассажиров не тревожим
  await page.getByRole('button', { name: /Подтвердить вариант/ }).click();
  await expect(page.getByText('План подтверждён')).toBeVisible();
  await page.goto('/#/overview?route=corridor');
  await expect(page.getByText('План подтверждён:')).toBeVisible();
  await page.goto('/#/decisions');
  await page.locator('.restrictions li', { hasText: 'D–E' }).getByRole('button', { name: 'Снять' }).click();
  await expect(page.getByText('Конфликтов нет')).toBeVisible();
});

test('attention badge appears in the menu while a closure awaits a decision', async ({ page }) => {
  await page.goto('/#/decisions');
  await closeSegment(page, 3, 'odd');
  await expect(page.locator('.nav-badge')).toBeVisible();
  await page.goto('/#/overview?route=corridor');
  await expect(page.getByRole('button', { name: 'Перейти к решению' })).toBeVisible();
});

test('closing both tracks needs a duration', async ({ page }) => {
  await page.goto('/#/decisions');
  await page.getByLabel('Какой путь закрыть').selectOption('both');
  await expect(page.getByRole('button', { name: /^Закрыть/ })).toHaveAttribute('aria-disabled', 'true');
  await page.getByLabel('Длительность закрытия').selectOption('120');
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(page.locator('.closure-list')).toContainText('оба пути');
});

test('speed restriction is entered and lifted, delays appear in KPIs', async ({ page }) => {
  await page.goto('/#/decisions');
  await page.getByLabel('Перегон', { exact: true }).selectOption('4');
  await page.getByLabel('Скорость, км/ч').selectOption('25');
  await page.getByRole('button', { name: 'Ввести', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Действующие и запланированные' })).toBeVisible();
  await page.goto('/#/overview?route=corridor');
  await expect(page.locator('.kpi', { hasText: 'Задержано поездов' })).not.toContainText('задержек нет');
  await page.goto('/#/decisions');
  await page.locator('.restrictions li', { hasText: '25 км/ч' }).getByRole('button', { name: 'Снять' }).click();
  await page.goto('/#/overview?route=corridor');
  await expect(page.locator('.kpi', { hasText: 'Задержано поездов' })).toContainText('задержек нет');
});

test('station lifecycle: complete, clear, reserve, time advance, admit', async ({ page, request }) => {
  const s0 = await getState(request);
  const track = s0.stations.flatMap(s => s.tracks.map(t => ({ ...t, st: s }))).find(t => t.processing > 0 && t.st.id !== 'A');
  const group = s0.groups.find(g => g.eligible && g.etaAt > s0.now && g.status === 'approaching');
  await page.goto(`/#/station/${track.st.id}`);
  await expect(page.getByRole('heading', { name: `Станция ${track.st.name}` })).toBeVisible();
  const row = page.locator('tbody tr').filter({ hasText: track.name }).first();
  await row.getByRole('button', { name: 'Завершить' }).click();
  await row.getByRole('button', { name: /Убрать \d+/ }).click();
  await expect(page.locator('.toast').last()).toContainText('убрано');
  await page.goto(`/#/station/${group.stationId}`);
  await page.getByRole('button', { name: 'Зарезервировать приём' }).click();
  await expect(page.locator('.kpi', { hasText: 'В резерве' })).not.toContainText(/^В резерве\s*0/);
  await page.getByRole('tab', { name: /Подход вагонов/ }).click();
  await expect(page).toHaveURL(new RegExp(`#/station/${group.stationId}/arrivals`));
  const reserved = (await getState(request)).groups.find(g => g.status === 'reserved');
  await advanceUntil(request, s => s.groups.find(g => g.id === reserved.id)?.etaAt <= s.now);
  await page.reload();
  await page.getByRole('tab', { name: /Подход вагонов/ }).click();
  await page.getByRole('button', { name: 'Принять' }).first().click();
  await expect(page.locator('.toast').last()).toContainText('принято');
});

test('keyboard focus survives an action (no full re-render)', async ({ page, request }) => {
  const s = await getState(request);
  const track = s.stations.flatMap(st => st.tracks.map(t => ({ ...t, st }))).find(t => t.processing > 0);
  await page.goto(`/#/station/${track.st.id}`);
  const row = page.locator('tbody tr').filter({ hasText: track.name }).first();
  const btn = row.getByRole('button', { name: 'Завершить' });
  await btn.focus();
  await page.keyboard.press('Enter');
  await expect(row.getByRole('button', { name: /Убрать \d+/ })).toBeVisible();
  await expect(btn).toBeFocused();
});

test('station list, deep link and unknown station', async ({ page }) => {
  await page.goto('/#/station/J');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Мойынты');
  await page.goto('/#/station/ZZ');
  await expect(page.getByText('Такой станции нет')).toBeVisible();
});

test('API rejects invalid operations without altering state', async ({ request }) => {
  const before = await (await request.get('/api/state')).json();
  for (const bad of [{ type: 'complete', trackId: 'X' }, { type: 'restrict', segment: 99, kmh: 25 }, { type: 'advance', minutes: 7 }, { type: 'nope' }]) {
    const res = await request.post('/api/action', { data: bad });
    expect(res.status()).toBe(400);
  }
  const after = await (await request.get('/api/state')).json();
  expect(after.revision).toBe(before.revision);
  expect((await request.get('/../server/model.js')).status()).toBe(404);
});

test('two tabs stay in sync', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await a.goto('/'); await b.goto('/');
  await a.getByRole('button', { name: '+15 мин' }).click();
  await expect(b.locator('.topbar .clock strong')).toHaveText('09:15');
});

test('phone layout: no horizontal overflow, bottom navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/', '/#/overview', '/#/overview?route=corridor', '/#/decisions', '/#/trains', '/#/station/D', '/#/log', '/#/how']) {
    await page.goto(path);
    await page.waitForSelector('main h1');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
  const nav = await page.locator('.nav').boundingBox();
  expect(nav.y).toBeGreaterThan(700);
});

test('how-it-works page: animated demos, stepper, cases, sandbox does not touch the shared shift', async ({ page, request }) => {
  await page.goto('/#/how');
  await expect(page.getByRole('heading', { name: 'Как это работает', level: 1 })).toBeVisible();
  // проблема: плеер переключает фазы
  const demo = page.locator('.problem');
  await expect(demo.locator('.demo-caption h3')).toHaveText('Всё идёт по графику');
  await demo.getByRole('button', { name: 'Следующий шаг' }).click();
  await expect(demo.locator('.demo-caption h3')).toHaveText('Сход на перегоне');
  // факторы
  await expect(page.locator('.factor')).toHaveCount(6);
  // алгоритм: реальный движок в браузере
  const stepper = page.locator('.stepper');
  await stepper.locator('.steps').getByRole('button', { name: /Находим конфликты/ }).click();
  await expect(stepper.locator('.stage-text')).toContainText('конфликт');
  await expect(stepper.locator('svg.lanes')).toBeVisible();
  await stepper.locator('.steps').getByRole('button', { name: /Строим варианты/ }).click();
  await expect(stepper.locator('.mini-variants figure')).toHaveCount(3);
  await stepper.locator('.steps').getByRole('button', { name: /Пассажиры узнают/ }).click();
  await expect(stepper.locator('.push').first()).toContainText('Поезд');
  // случаи
  await page.getByRole('tab', { name: 'Окно и ограничение скорости' }).click();
  await expect(page.locator('.flow')).toContainText('25 км/ч');
  // песочница
  const sb = page.locator('.sandbox');
  await sb.getByRole('button', { name: /Закрыть перегон D–E/ }).click();
  await expect(sb.locator('.sandbox-kpis span').first()).not.toHaveText(/^0 /);
  await sb.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(sb.locator('.sandbox-kpis')).toContainText('уведомлений пассажирам');
  expect((await (await request.get('/api/state')).json()).blocked).toBe(false);
});

test('quick search navigates without changing the shared shift and restores focus', async ({ page, request }) => {
  const before = await (await request.get('/api/state')).json();
  await page.goto('/#/overview?route=corridor');
  const trigger = page.getByRole('button', { name: 'Поиск поездов и станций' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Найти поезд или станцию' });
  const input = dialog.getByRole('searchbox');
  await expect(input).toBeFocused();
  await input.fill('153');
  await dialog.getByRole('button', { name: /№153/ }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.selection')).toContainText('№153');
  await page.keyboard.press('Control+k');
  await expect(dialog).toBeVisible();
  await input.fill('Дария');
  await dialog.getByRole('region', { name: 'Найденные станции' }).getByRole('button', { name: /Дария/ }).click();
  await expect(page).toHaveURL(/#\/station\/D/);
  await expect(page.getByRole('heading', { name: 'Станция Дария' })).toBeVisible();
  await trigger.click();
  await input.fill('несуществующий объект');
  await expect(dialog.getByRole('status')).toContainText('Ничего не найдено');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect((await (await request.get('/api/state')).json()).revision).toBe(before.revision);
});

test('live map opens a station and mobile overflow menu preserves secondary routes', async ({ page }) => {
  await page.goto('/#/overview?route=corridor');
  await expect(page.locator('.m-station a')).toHaveCount(10);
  await page.getByRole('link', { name: /^Станция Жарык,/ }).click();
  await expect(page.getByRole('heading', { name: 'Станция Жарык' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.mobile-more summary').click();
  await page.locator('.more-links').getByRole('link', { name: 'Журнал', exact: true }).click();
  await expect(page).toHaveURL(/#\/log/);
  await expect(page.locator('.mobile-more')).not.toHaveAttribute('open', '');
  await page.locator('.mobile-more summary').click();
  await page.locator('.more-links').getByRole('link', { name: 'Как это работает' }).click();
  await expect(page).toHaveURL(/#\/how/);
  await page.locator('.mobile-more summary').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.more-links')).not.toBeVisible();
});

test('tablet and desktop layouts contain overflow within data regions', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  for (const width of [768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const path of ['/', '/#/overview?route=corridor', '/#/trains', '/#/decisions', '/#/stations']) {
      await page.goto(path);
      await page.waitForSelector('main h1');
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `${path} at ${width}`).toBeLessThanOrEqual(0);
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#/overview?route=corridor');
  await expect(page.locator('.trackmap')).toBeVisible();
  expect(errors).toEqual([]);
});

test('live map: trains are drawn, move with time, closure makes some stand and wait', async ({ page, request }) => {
  await page.goto('/#/overview?route=corridor');
  const map = page.locator('.trackmap');
  await expect(map).toBeVisible();
  await expect(map.locator('.mtrain').first()).toBeVisible();
  const before = await map.locator('.mtrain').first().getAttribute('transform');
  await request.post('/api/action', { data: { type: 'advance', minutes: 15 } });
  await expect.poll(() => map.locator('.mtrain').first().getAttribute('transform')).not.toBe(before);
  await expect(page.getByRole('heading', { name: 'Панель диспетчера' })).toBeVisible();
  await api(request, { type: 'close', segment: 3, track: 'both', minutes: 240 });
  await advanceUntil(request, waitingNow, 24, 15);
  await expect(map.locator('.m-closed').first()).toBeVisible();
  await expect(map.locator('.mtrain.stopped').first()).toBeVisible({ timeout: 8000 });
  await expect(page.locator('.task-danger', { hasText: 'стоит на' }).first()).toBeVisible();
  await map.locator('.mtrain').first().click();
  await expect(page.locator('.map-info')).toContainText('№');
});

test('live map: the clock offers real time and accelerated modes; play and pause work', async ({ page }) => {
  await page.goto('/#/overview?route=corridor');
  const speed = page.getByRole('radiogroup', { name: 'Скорость времени' });
  for (const label of ['Реальное', '×60', '×180', '×600']) await expect(speed.getByRole('radio', { name: label, exact: true })).toBeVisible();
  await speed.getByRole('radio', { name: '×600', exact: true }).click();
  await page.getByRole('button', { name: 'Пуск' }).click();
  await expect(page.locator('.topbar .clock strong')).not.toHaveText('09:00', { timeout: 6000 });
  await expect(page.locator('.topbar .clock small')).toContainText('ускорено');
  await page.getByRole('button', { name: 'Пауза' }).click();
  await expect(page.locator('.topbar .clock small')).toContainText('на паузе');
  const t = await page.locator('.topbar .clock strong').innerText();
  await page.waitForTimeout(1500);
  expect(await page.locator('.topbar .clock strong').innerText()).toBe(t);
});

test('menu can be collapsed to give the map more room and the choice is remembered', async ({ page }) => {
  await page.goto('/#/overview?route=corridor');
  const w0 = (await page.locator('.nav').boundingBox()).width;
  await page.getByRole('button', { name: 'Свернуть меню' }).click();
  await expect.poll(async () => (await page.locator('.nav').boundingBox()).width).toBeLessThan(w0 / 2);
  await page.reload();
  expect((await page.locator('.nav').boundingBox()).width).toBeLessThan(w0 / 2);
});

test('map zoom levels change the drawn size and the mini-map jumps to a place', async ({ page }) => {
  await page.goto('/#/overview?route=corridor');
  const svg = page.locator('.map-scroll > svg');
  await page.getByRole('radio', { name: 'Обычный' }).click();
  const normal = (await svg.boundingBox()).width;
  await page.getByRole('radio', { name: 'Крупно' }).click();
  expect((await svg.boundingBox()).width).toBeGreaterThan(normal * 1.2);
  await page.getByRole('radio', { name: 'Весь участок' }).click();
  expect((await svg.boundingBox()).width).toBeLessThan(normal);
  await page.getByRole('radio', { name: 'Обычный' }).click();
  const scroll = page.locator('.map-scroll');
  await scroll.evaluate(el => { el.scrollLeft = 0; });
  await page.locator('.minimap').click({ position: { x: 900, y: 20 } });
  await expect.poll(() => scroll.evaluate(el => el.scrollLeft)).toBeGreaterThan(300);
});

test('dispatcher panel: tasks, approve from the task, expedite a stopped train', async ({ page, request }) => {
  await page.goto('/#/overview?route=corridor');
  const panel = page.locator('.dispatcher');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.task', { hasText: 'Подтвердите вариант пропуска' })).toHaveCount(0);
  await api(request, { type: 'block' });
  const approve = panel.locator('.task', { hasText: 'Подтвердите вариант пропуска' });
  await expect(approve).toBeVisible();
  await advanceUntil(request, s => s.trains.some(t => t.forecast.some(([, i], k) => k && i === t.forecast[k - 1][1] && (i === 3 || i === 4))), 6);
  const stopTask = panel.locator('.task', { hasText: 'стоит на' }).first();
  if (await stopTask.count()) {
    const button = stopTask.getByRole('button', { name: 'Пропустить первым' });
    if (await button.count()) { await button.click(); await expect(page.locator('.toast').last()).toContainText('пропускается первым'); }
  }
  await approve.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(approve).toHaveCount(0);
});

test('dispatcher panel: hold a selected train on its next station and release it', async ({ page, request }) => {
  const s = await getState(request);
  const train = runningTrain(s);
  await page.goto('/#/overview?route=corridor');
  await page.waitForSelector('.trackmap');
  await page.goto(`/#/overview?route=corridor&train=${train.number}`);
  const panel = page.locator('.dispatcher');
  await expect(panel.locator('.tc-num')).toHaveText(`№${train.number}`);
  await panel.getByRole('radio', { name: '20' }).click();
  await panel.getByRole('button', { name: 'Задержать на 20 мин' }).click();
  await expect(page.locator('.toast').last()).toContainText('задержан на станции');
  await expect(panel.locator('.tc-head')).toContainText('+20 мин');
  await panel.getByRole('button', { name: 'Снять задержки' }).click();
  await expect(panel.locator('.tc-head')).toContainText('по графику');
});

test('dispatcher panel shows train characteristics, load and maintenance', async ({ page, request }) => {
  const train = runningTrain(await getState(request));
  await page.goto('/#/overview?route=corridor');
  await page.waitForSelector('.trackmap');
  await page.goto(`/#/overview?route=corridor&train=${train.number}`);
  const facts = page.locator('.dispatcher .facts');
  for (const label of ['Локомотив', 'Масса брутто', 'Скорость ср. / макс.', 'Бригада за рулём', 'Техобслуживание', 'Тех. состояние']) await expect(facts).toContainText(label);
});

test('breakdown: level 1 slows the train, level 3 removes it and blocks its track; both are visible on the map and in the KPI', async ({ page, request }) => {
  const s = await getState(request);
  const t1 = runningTrain(s);
  await page.goto('/#/overview?route=corridor');
  await page.waitForSelector('.trackmap');
  await page.goto(`/#/overview?route=corridor&train=${t1.number}`);
  const panel = page.locator('.dispatcher');
  await panel.getByRole('radio', { name: /1\. Лёгкая/ }).click();
  await panel.getByRole('button', { name: 'Спроецировать' }).click();
  await expect(page.locator('.toast').last()).toContainText('Поломка');
  await expect(panel.locator('.tc-head')).toContainText('Лёгкая поломка');
  await expect(page.locator('.kpi', { hasText: 'ТО и поломки' })).toContainText('1 с поломкой');
  await expect(page.locator('.mtrain.broken')).toHaveCount(1);
  // тяжёлая поломка у другого поезда
  const t2 = (await getState(request)).trains.find(t => t.number !== t1.number && t.forecast[0][0] <= minutesNow(s) && t.forecast.at(-1)[0] > minutesNow(s) + 60 && !t.service && !t.broken);
  await page.goto(`/#/overview?route=corridor&train=${t2.number}`);
  await panel.getByRole('radio', { name: /3\. Тяжёлая/ }).click();
  await panel.getByRole('button', { name: 'Спроецировать' }).click();
  await expect(panel.locator('.tc-head')).toContainText('снят с рейса');
  await expect(panel.locator('.task', { hasText: t2.number }).first()).toBeVisible();
});

test('API: breakdown levels, closure of both tracks and automatic settings are validated', async ({ request }) => {
  const s = await getState(request);
  const train = runningTrain(s);
  for (const bad of [{ type: 'breakdown', train: train.number, level: 9 }, { type: 'breakdown', train: 'zz', level: 1 }, { type: 'breakdown', train: train.number, level: 4, kind: 'wheelset' },
    { type: 'close', segment: 2, track: 'both' }, { type: 'close', segment: 2, track: 'up', minutes: 30 }, { type: 'auto', intensity: 'extreme' }, { type: 'clock', speed: 7 }]) {
    expect((await request.post('/api/action', { data: bad })).status(), JSON.stringify(bad)).toBe(400);
  }
  const ok = await api(request, { type: 'breakdown', train: train.number, level: 4, kind: 'derail' });
  expect(ok.trains.find(t => t.number === train.number).disabled).toBe(true);
  expect(ok.dispatch.closures.some(c => c.track === 'both')).toBe(true);
  const auto = await api(request, { type: 'auto', intensity: 'high', approve: true });
  expect(auto.auto).toMatchObject({ intensity: 'high', approve: true });
});

test('map is tied to data: arrived wagon groups are flagged on the station and can be accepted from the panel', async ({ page, request }) => {
  await page.goto('/#/overview?route=corridor');
  const s = await advanceUntil(request, st => st.groups.some(g => g.eligible && g.etaAt <= st.now), 12);
  const group = s.groups.find(g => g.eligible && g.etaAt <= s.now);
  const index = s.stations.findIndex(st => st.id === group.stationId);
  await expect(page.locator('.m-badge.on').first()).toBeVisible();
  await page.locator('.m-pick').nth(index).click();
  const panel = page.locator('.dispatcher');
  await expect(panel.locator('.tc-num')).toHaveText(s.stations[index].name);
  const accept = panel.getByRole('button', { name: 'Принять' }).filter({ has: page.locator('xpath=self::*[not(@aria-disabled="true")]') }).first();
  await expect(accept).toBeEnabled();
  await accept.click();
  await expect(page.locator('.toast').last()).toContainText('принято');
});

test('station cards and map agree on occupied wagons and the arrival queue', async ({ page, request }) => {
  await page.goto('/#/overview?route=corridor');
  const s = await advanceUntil(request, st => st.groups.some(g => g.eligible && g.etaAt <= st.now), 12);
  const g = s.groups.find(x => x.eligible && x.etaAt <= s.now);
  await api(request, { type: 'reserve', groupId: g.id });
  const data = await getState(request);
  const st = data.stations.find(x => x.id === g.stationId);
  const waiting = data.groups.filter(x => x.stationId === st.id && x.status !== 'arrived' && x.etaAt <= data.now).length;
  await page.goto('/#/overview?route=corridor');
  const station = page.locator('.m-station').filter({ has: page.getByRole('link', { name: new RegExp(`^Станция ${st.name},`) }) });
  await expect(station.locator('.m-load')).toHaveText(`${st.occupied} / ${st.capacity} ваг.`);
  await expect(station.locator('.m-badge-t')).toHaveText(`ждут приёма ${waiting}`);
  await api(request, { type: 'arrive', groupId: g.id });
  const after = (await getState(request)).stations.find(x => x.id === st.id);
  await expect(station.locator('.m-load')).toHaveText(`${after.occupied} / ${after.capacity} ваг.`);
});

test('automation settings can be changed from the interface', async ({ page, request }) => {
  await page.goto('/#/decisions');
  const group = page.getByRole('radiogroup', { name: 'Интенсивность случайных событий' });
  await group.getByRole('radio', { name: 'Частые' }).click();
  await expect.poll(async () => (await getState(request)).auto.intensity).toBe('high');
  await page.getByLabel('Автопилот: применять рекомендацию через 15 мин').click();
  await expect.poll(async () => (await getState(request)).auto.approve).toBe(true);
  await page.getByLabel('Станции работают сами').click();
  await expect.poll(async () => (await getState(request)).auto.stations).toBe(false);
});

test('fleet page: approximate locomotive park, depots, delivery figures and sources', async ({ page }) => {
  await page.goto('/#/fleet');
  await expect(page.getByRole('heading', { name: 'Парк и сеть', level: 1 })).toBeVisible();
  await expect(page.locator('.kpi', { hasText: 'Электровозы' })).toContainText('≈');
  await expect(page.locator('.kpi', { hasText: 'Магистральные тепловозы' })).toContainText('≈');
  await expect(page.locator('.kpi', { hasText: 'Станции' })).toContainText(/\d{3}/);
  await expect(page.getByText('Новые поставки 2026')).toBeVisible();
  await expect(page.locator('.series-now li').first()).toBeVisible();
  await expect(page.getByRole('row', { name: /Атырау/ })).toBeVisible();
  await expect(page.locator('.sources a').first()).toHaveAttribute('href', /^https:/);
  await expect(page.getByText(/не официальная статистика/)).toBeVisible();
});

test('fleet page: search across all stations of Kazakhstan and open one on the map', async ({ page }) => {
  await page.goto('/#/fleet');
  await page.getByRole('searchbox', { name: 'Найти станцию' }).fill('Тараз');
  const row = page.locator('.station-list li', { hasText: 'Тараз' }).first();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'На карте' }).click();
  await expect(page).toHaveURL(/\/#\/?$/);
  await expect(page.locator('.net-chip', { hasText: 'Станции' })).toHaveAttribute('aria-pressed', 'true', { timeout: 10000 });
});

test('map: national station layers, depots and station search', async ({ page }) => {
  await page.goto('/#/map');
  const bar = page.getByRole('group', { name: 'Сеть железных дорог Казахстана' });
  await expect(bar).toBeVisible();
  const stations = bar.getByRole('button', { name: /Станции/ });
  await expect(stations).toBeEnabled({ timeout: 15000 });
  await expect(stations).toContainText(/\d{3}/);
  await stations.click();
  await expect(stations).toHaveAttribute('aria-pressed', 'true');
  await bar.getByRole('button', { name: /Локомотивные депо/ }).click();
  await expect(page.locator('.geo-depot').first()).toBeVisible();
  await bar.getByRole('searchbox', { name: 'Найти станцию Казахстана' }).fill('Атырау');
  await bar.getByRole('button', { name: /Атырау/ }).first().click();
  await expect(page.locator('.leaflet-popup-content')).toContainText('Атырау', { timeout: 8000 });
  await expect(page.locator('.fleet-summary.compact')).toContainText('Локомотивы КТЖ');
});

test('home page is the whole KTZ network: hundreds of trains, stations and statistics', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Сеть КТЖ в реальном времени', level: 1 })).toBeVisible();
  const trains = page.locator('.kpi', { hasText: 'Поездов на сети' });
  await expect(trains).toBeVisible();
  await expect.poll(async () => Number((await trains.locator('.kpi-value').innerText()).replace(/\D/g, ''))).toBeGreaterThan(400);
  await expect(page.locator('.kpi', { hasText: 'Локомотивы в пути' })).toContainText('электровозов');
  await expect(page.getByRole('region', { name: /Карта железнодорожной сети Казахстана/ })).toBeVisible();
  await expect(page.locator('.net-chip', { hasText: 'Станции' })).toHaveAttribute('aria-pressed', 'true', { timeout: 15000 });
  await expect(page.locator('.net-count')).toContainText(/На карте \d{3}/);
  await page.getByRole('radio', { name: 'Пассажирские' }).click();
  await expect(page.locator(".net-count strong")).not.toHaveText("0");
});

test('network page: forced stops list, train card and fleet summary', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.net-list');
  await expect(page.locator('.fleet-summary.compact')).toContainText('Локомотивы КТЖ');
  const first = page.locator('.net-list button').first();
  if (await first.count()) {
    await first.click();
    await expect(page.locator('.net-train')).toBeVisible();
    await expect(page.locator('.net-train')).toContainText('Локомотив');
    await page.locator('.net-train').getByRole('button', { name: 'Снять' }).click();
    await expect(page.locator('.net-train')).toHaveCount(0);
  }
});

test('network lists: all trains, all stations, journal and model decisions have filters', async ({ page }) => {
  await page.goto('/#/trains');
  await expect(page.getByRole('heading', { name: 'Поезда', level: 1, exact: true })).toBeVisible();
  await expect.poll(async () => Number((await page.locator('.mini-kpis strong').first().innerText()).replace(/\D/g, ''))).toBeGreaterThan(400);
  await page.getByRole('radio', { name: 'Пассажирские' }).click();
  await page.getByRole('searchbox').fill('Астана');
  await expect(page.locator('tbody tr').first()).toContainText('Астана');
  await page.goto('/#/stations');
  await expect.poll(async () => Number((await page.locator('.mini-kpis strong').first().innerText()).replace(/\D/g, ''))).toBeGreaterThan(500);
  await page.getByRole('searchbox').fill('Караганда');
  await expect(page.locator('tbody tr').first()).toContainText('Караганда');
  await page.goto('/#/log');
  await expect.poll(async () => page.locator('.timeline li').count()).toBeGreaterThan(50);
  await page.getByRole('radio', { name: 'Смена бригады' }).click();
  await expect(page.locator('.timeline li').first()).toContainText('Смена бригады поезда');
  await page.goto('/#/model');
  await expect(page.getByRole('heading', { name: 'Решения модели', level: 1 })).toBeVisible();
  await expect(page.locator('.model-card').first()).toContainText('Почему так');
  await page.getByRole('radio', { name: 'Сократить' }).click();
  await page.getByRole('tab', { name: 'Журнал решений' }).click();
  await expect(page.locator('.timeline li').first()).toBeVisible();
});

test('network train card shows crew, locomotive, consist and technical characteristics', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.net-kpis')).toBeVisible();
  await page.goto('/#/trains');
  await expect(page.getByRole('columnheader', { name: 'Бригада' })).toBeVisible();
  await expect(page.locator('tbody tr').first()).toContainText('до смены');
  await page.locator('tbody tr').first().getByRole('button', { name: 'На карте' }).click();
  await expect(page.locator('.specs section[aria-label="Бригада"]')).toContainText('Отработано');
  await expect(page.locator('.specs section[aria-label="Локомотив"]')).toContainText('До ТО');
  await expect(page.locator('.specs section[aria-label="Состав"]')).toContainText('Масса брутто');
});

test('statistics page: decisions, savings, per-route and live snapshot sections', async ({ page }) => {
  await page.goto('/#/stats');
  await expect(page.getByRole('heading', { name: 'Статистика работы модели', level: 1 })).toBeVisible();
  await expect(page.locator('.kpi', { hasText: 'Решений за период' })).toBeVisible();
  await expect.poll(async () => Number((await page.locator('.kpi', { hasText: 'Решений за период' }).locator('.kpi-value').innerText()).replace(/\D/g, ''))).toBeGreaterThan(500);
  await expect(page.getByRole('heading', { name: 'Решения по типам' })).toBeVisible();
  await expect(page.getByRole('img', { name: /Число решений по часам/ })).toBeVisible();
  expect(await page.locator('h2', { hasText: 'По участкам' }).count()).toBe(1);
  await page.getByRole('radio', { name: '6 часов' }).click();
  await expect(page.getByRole('heading', { name: /Как работала модель/ })).toBeVisible();
});

test('dispatcher panel: route schematic, ГИД, closure with variants and approval change the route', async ({ page, request }) => {
  await page.goto('/#/overview?route=AST-ALA');
  await expect(page.getByRole('heading', { name: 'Астана — Алматы', level: 2 })).toBeVisible();
  await expect(page.locator('.trackmap')).toBeVisible();
  await expect(page.getByRole('img', { name: /График движения маршрута/ })).toBeVisible();
  await expect(page.locator('.trackmap .mtrain').first()).toBeAttached();
  // другой маршрут из списка слева
  await page.locator('.dp-rail').getByRole('link', { name: /Караганда — Павлодар/ }).click();
  await expect(page).toHaveURL(/route=KRG-PAV/);
  await expect(page.getByRole('heading', { name: 'Караганда — Павлодар', level: 2 })).toBeVisible();
  // событие: закрыть оба пути на 2 часа
  await page.getByRole('radio', { name: 'Закрыть путь' }).click();
  await page.getByLabel('Какой путь закрыть').selectOption('both');
  await page.getByLabel('Длительность', { exact: true }).selectOption('120');
  await page.getByRole('button', { name: 'Создать событие' }).click();
  await expect(page.locator('.incident')).toHaveCount(1);
  await expect(page.locator('.incident')).toContainText('Закрыты оба пути');
  await expect(page.locator('.variant')).toHaveCount(3);
  await expect(page.locator('.variant').filter({ hasText: 'Рекомендуется' })).toHaveCount(1);
  await page.getByRole('button', { name: /Подтвердить «/ }).click();
  await expect(page.locator('.variant.applied')).toHaveCount(1);
  await page.getByRole('button', { name: 'Снять' }).first().click();
  await expect(page.locator('.incident')).toHaveCount(0);
  const res = await request.get('/api/net/incidents');
  expect((await res.json()).incidents).toHaveLength(0);
});

test('dispatcher panel API rejects invalid incidents', async ({ request }) => {
  for (const bad of [{ type: 'add', incident: { kind: 'closure', routeId: 'XXX-YYY', a: 1, b: 9, track: 'even', minutes: 30 } },
    { type: 'add', incident: { kind: 'closure', routeId: 'AST-ALA', a: 1, b: 9, track: 'both' } },
    { type: 'add', incident: { kind: 'restriction', routeId: 'AST-ALA', a: 1, b: 9, kmh: 200, minutes: 30 } },
    { type: 'remove', id: 'nope' }, { type: 'nope' }]) {
    const res = await request.post('/api/net/incidents', { data: bad });
    expect(res.status(), JSON.stringify(bad)).toBe(400);
  }
});

test('model page: pipeline of stages, inputs and results, event tape and metrics update in real time', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/#/engine');
  await expect(page.getByRole('heading', { name: 'Модель', level: 1, exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: /Граф потока данных модели/ })).toBeVisible();
  await page.getByRole('button', { name: /Поезда на линии:/ }).click();
  await expect(page.locator('.flow-detail')).toContainText('рейс активен');
  await expect(page.locator('.stage-card')).toHaveCount(4);
  await page.locator('.mrow-head', { hasText: 'Профили и положения' }).click();
  await expect(page.locator('.mrow.open .mrow-detail')).toContainText('кусочно-линейная');
  await expect.poll(async () => page.locator('.tape-row').count()).toBeGreaterThan(1);
  await page.getByRole('radio', { name: 'Решения', exact: true }).click();
  await expect(page.locator('.tape-row.decision').first()).toBeVisible();
  await expect(page.locator('.metric-card')).toHaveCount(12);
  await expect(page.getByRole('heading', { name: 'Полная формула модели' })).toBeVisible();
  await expect(page.locator('.fbook-lead')).toContainText('факторов');
  await expect(page.locator('.master .eq')).toHaveCount(3);
  await page.getByRole('radio', { name: /Бригады/ }).click();
  await expect(page.locator('.system .eq').first()).toContainText('B1');
  await expect(page.locator('.vars tbody tr').first()).toBeVisible();
  await page.getByRole('button', { name: /Покрытие факторов/ }).click();
  await expect(page.locator('.coverage tbody tr').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Характеристики модели' })).toBeVisible();
  const cycles = async () => Number(((await page.locator('.page-actions .badge').innerText()).match(/цикл ([\d\s\u00a0]+)/)?.[1] || '0').replace(/\D/g, ''));
  const first = await cycles();
  await expect.poll(cycles, { timeout: 5000 }).toBeGreaterThan(first + 3);   // 4 цикла в секунду
  expect(errors).toEqual([]);
});
