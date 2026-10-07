import { test, expect } from '@playwright/test';

test('automatic schedule exists before manual calculation and service pushes a local revision', async ({ page, request }) => {
  await page.goto('/#/schedules');
  await expect(page.getByRole('heading', { name: 'График рейсов' })).toBeVisible();
  const before = await (await request.get('/api/schedule')).json();
  expect(before.plan.optimized.rows.length).toBeGreaterThan(100);
  const row = before.plan.optimized.rows.find(r => r.locoId?.startsWith('reserve:'));
  await page.getByLabel('Локомотив для обслуживания').selectOption(row.locoId);
  await page.getByLabel('Вид обслуживания').selectOption('daily');
  await page.getByRole('button', { name: 'Назначить работы и пересчитать' }).click();
  await expect(page.getByText(/Пересчёт завершён:/)).toBeVisible();
  const after = await (await request.get('/api/schedule')).json();
  expect(after.plan.revision).toBe((before.plan.revision || 0) + 1);
  expect(after.plan.constraints.at(-1).until - after.plan.constraints.at(-1).from).toBe(86400000);
  await page.goto('/#/model');
  await page.getByRole('tab', { name: 'Изменения расписания' }).click();
  await expect(page.getByText(/Суточное обслуживание · изменено/)).toBeVisible();
});

test('schedules assign locomotives, show cost inputs, persist and export the plan', async ({ page, request }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/#/schedules');
  await expect(page.getByRole('heading', { name: 'Расписания', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Рейсы и назначения' })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(60);
  await page.getByLabel('Дизель на стоянке, л/ч', { exact: true }).fill('10');
  await page.getByLabel('Дизель, ₸/л', { exact: true }).fill('200');
  await page.getByLabel('Электроэнергия на стоянке, кВт·ч/ч', { exact: true }).fill('20');
  await page.getByLabel('Электроэнергия, ₸/кВт·ч', { exact: true }).fill('30');
  await page.getByRole('button', { name: 'Сохранить общий план' }).click();
  await expect(page.getByText('План сохранён на сервере и доступен всем диспетчерам.')).toBeVisible();
  const data = await (await request.get('/api/schedule')).json();
  expect(data.plan.optimized.assigned).toBeGreaterThan(0);
  expect(data.rates.dieselPrice).toBe(200);
  await page.reload();
  await expect(page.getByLabel('Дизель, ₸/л', { exact: true })).toHaveValue('200');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/ktz-schedules-mobile.png' });
  expect(errors).toEqual([]);
});

test('full train passport, station operations and mobile layout', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/#/trains');
  const open = page.getByRole('button', { name: /Полная информация о поезде/ }).first();
  await open.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Осевая нагрузка')).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Прогноз остановок и операций' })).toBeVisible();
  await page.screenshot({ path: '/tmp/ktz-train-desktop.png' });
  await page.keyboard.press('Escape');
  await expect(open).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/stations');
  await page.getByRole('button', { name: /Подробно о станции/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Ожидаемые прибытия' })).toBeVisible();
  await page.screenshot({ path: '/tmp/ktz-station-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.getByRole('dialog').evaluate(d => d.scrollWidth <= d.clientWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('all-time stats and untruncated exports contain every dataset and explanation', async ({ page, request }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/#/stats');
  await expect(page.getByRole('radio', { name: 'За всё время' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Посмотреть все решения' }).click();
  await expect(page.locator('.live-timeline li').first()).toBeVisible();
  await page.getByText('Почему и какой эффект', { exact: true }).first().click();
  await expect(page.locator('details[open]')).toContainText('Поезд №');
  const response = await request.get('/api/network-export?section=all');
  expect(response.ok()).toBe(true);
  const dump = await response.json();
  expect(dump.trains.length).toBeGreaterThan(100);
  expect(dump.trains[0].itinerary.length).toBeGreaterThan(1);
  expect(dump.stations.operational.length).toBeGreaterThan(1000);
  expect(dump.journal.events.length).toBeGreaterThan(1000);
  expect(dump.decisions.history.length).toBe(dump.journal.events.length);
  expect(dump.model.routes.routes.length).toBeGreaterThan(40);
  expect(dump.journal.events.every(e => e.id && e.explanation)).toBe(true);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Все данные · JSON', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/^ktz-all-.*\.json$/);
  expect(errors).toEqual([]);
});

test('live journal inserts sub-second events, stable rows keep focus, pause freezes reading', async ({ page }) => {
  await page.goto('/#/log');
  await expect(page.locator('.live-timeline li').first()).toBeVisible();
  // Choose an actual future event and advance only the local display clock across its boundary.
  const event = await page.evaluate(async () => {
    const { prepare, networkEvents } = await import('/js/network-sim.js');
    const { clock } = await import('/js/store.js');
    const sim = prepare(await (await fetch('/data/kz-routes.json')).json());
    return networkEvents(sim, clock.now + 60000, 1).filter(e => e.at > clock.now).at(-1);
  });
  expect(event).toBeTruthy();
  await page.evaluate(async at => { const { clock } = await import('/js/store.js'); clock.now = at - 100; clock.running = false; }, event.at);
  await page.waitForTimeout(150);
  const historyRow = page.locator('.live-timeline li').nth(3);
  const summary = historyRow.locator('summary');
  await summary.focus();
  await summary.evaluate(el => { el.dataset.testIdentity = 'retained'; });
  await page.evaluate(async at => { const { clock } = await import('/js/store.js'); clock.now = at + 1; }, event.at);
  await expect(page.locator('.live-timeline li').first()).toContainText(event.text, { timeout: 900 });
  await expect(page.locator('[data-test-identity="retained"]')).toBeFocused();
  await page.getByRole('button', { name: 'Пауза ленты' }).click();
  const text = await page.locator('.live-timeline').innerText();
  await page.evaluate(async () => { const { clock } = await import('/js/store.js'); clock.now += 60000; });
  await page.waitForTimeout(300);
  expect(await page.locator('.live-timeline').innerText()).toBe(text);
  await page.getByRole('button', { name: 'К прямому эфиру' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/ktz-log-mobile.png' });
});
