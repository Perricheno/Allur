import { test, expect } from '@playwright/test';
const tile = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf9sAAAAASUVORK5CYII=', 'base64');
test.beforeEach(async ({ page, request }) => {
  await request.post('/api/action', { data: { type: 'reset' } });
  await page.route(/https:\/\/(tile.openstreetmap.org|tiles.openrailwaymap.org)\//, route => route.fulfill({ contentType: 'image/png', body: tile }));
});

test('map selection, train movement and layer controls share the dispatcher state', async ({ page, request }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/#/map');
  await expect(page.locator('.geo-station-icon')).toHaveCount(10);
  const before = await (await request.get('/api/state')).json();
  await page.getByRole('button', { name: 'Выбрать станцию Дария', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.geo-details h2')).toHaveText('Дария');
  await page.getByRole('button', { name: 'Команды диспетчера', exact: true }).click();
  await expect(page.locator('.dispatcher .tc-head')).toContainText('Дария');
  await expect(page.getByRole('link', { name: 'Грузовая работа станции' })).toHaveAttribute('href', '#/station/D');
  const now = (before.now - before.baseTime) / 60000;
  const train = before.trains.find(t => t.forecast[0][0] < now && t.forecast.at(-1)[0] > now + 30 && !t.service);
  await page.getByLabel('Выбрать поезд на карте').selectOption(train.number);
  await expect(page.locator('.geo-details h2')).toHaveText(`Поезд №${train.number}`);
  await expect(page.locator('.dispatcher .tc-head')).toContainText(train.number);
  const marker = page.getByRole('button', { name: `Выбрать поезд №${train.number}`, exact: true });
  const transform = await marker.getAttribute('style');
  await request.post('/api/action', { data: { type: 'advance', minutes: 15 } });
  await expect.poll(() => marker.getAttribute('style')).not.toBe(transform);
  await page.getByRole('button', {name:'Настройки', exact:true}).click();
  await page.getByLabel('Слой OpenRailwayMap').uncheck();
  await expect(page.locator('.geo-map img[src*="tiles.openrailwaymap.org"]')).toHaveCount(0);
  await page.getByLabel('Слой OpenRailwayMap').check();
  await expect(page.locator('.geo-map img[src*="tiles.openrailwaymap.org"]').first()).toBeAttached();
  expect(errors).toEqual([]);
});

test('map keeps stations and moving trains when external tiles fail, on a phone', async ({ page }) => {
  await page.unroute(/https:\/\/(tile.openstreetmap.org|tiles.openrailwaymap.org)\//);
  await page.route(/https:\/\/(tile.openstreetmap.org|tiles.openrailwaymap.org)\//, route => route.abort());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/map');
  await expect(page.getByRole('status').filter({ hasText: 'Фоновая карта недоступна' })).toBeVisible();
  await expect(page.locator('.geo-station-icon')).toHaveCount(10);
  await expect(page.locator('.geo-train-icon').first()).toBeAttached();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  await page.locator('.mobile-more summary').click();
  await expect(page.locator('.more-links').getByRole('link', { name: 'Статистика', exact: true })).toBeVisible();
  await page.goto('/#/stations');
  await page.goto('/#/map');
  await expect(page.locator('.geo-station-icon')).toHaveCount(10);
  await expect(page.locator('.leaflet-container')).toHaveCount(1);
});

test('map highlights closures and speed restrictions on the selected corridor', async ({ page, request }) => {
  await page.goto('/#/map');
  await expect(page.locator('.geo-station-icon')).toHaveCount(10);
  await request.post('/api/action', { data: { type: 'restrict', segment: 5, kmh: 25 } });
  await expect(page.locator('.geo-map path[stroke="#a96b06"]')).toHaveCount(1);
  await request.post('/api/action', { data: { type: 'close', segment: 3, track: 'odd', reason: 'derailment' } });
  await expect(page.locator('.geo-map path[stroke="#bf2520"]')).toHaveCount(1);
});

test('dispatcher filters, map settings and station shortcut keep the workspace focused', async ({ page }) => {
  await page.goto('/#/map');
  await expect(page.locator('.geo-train-icon').first()).toBeAttached();
  await expect(page.locator('#geo-dispatcher')).not.toHaveAttribute('open');
  await expect(page.getByLabel('Скорость времени на карте')).toBeHidden();
  await page.getByRole('radio', { name: 'Пассажирские', exact: true }).click();
  await expect(page.locator('.geo-train:not(.passenger)')).toHaveCount(0);
  await expect(page.locator('.geo-train.passenger').first()).toBeAttached();
  await page.getByRole('radio', { name: 'Грузовые', exact: true }).click();
  await expect(page.locator('.geo-train.passenger')).toHaveCount(0);
  await expect(page.locator('.geo-train-icon').first()).toBeAttached();
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByLabel('Всегда показывать номера').check();
  await expect(page.locator('.geo-train.compact')).toHaveCount(0);
  await page.getByLabel('Названия станций', { exact: true }).uncheck();
  await expect(page.locator('.geo-station-label')).toHaveCount(0);
  await page.getByLabel('Названия станций', { exact: true }).check();
  await expect(page.locator('.geo-station-label')).toHaveCount(10);
  await page.getByLabel('Найти станцию на карте').selectOption('D');
  await expect(page.locator('.geo-details h2')).toHaveText('Дария');
  await expect(page.getByRole('progressbar', { name: 'Занятость подъездных путей' })).toBeVisible();
  await page.getByRole('button', {name:'Команды диспетчера',exact:true}).click();
  await expect(page.locator('#geo-dispatcher')).toHaveAttribute('open');
  await expect(page.locator('.dispatcher .tc-head')).toContainText('Дария');
});

test('attention list and filter show the affected train, and commands leave fullscreen', async ({ page, request }) => {
  const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  const state = await (await request.get('/api/state')).json();
  const tMin = (state.now - state.baseTime) / 60000;
  const train = state.trains.find(t => t.forecast[0][0] <= tMin && t.forecast.at(-1)[0] > tMin + 60 && !t.service);
  const response = await request.post('/api/action', { data: { type:'breakdown', train:train.number, level:3, kind:'wheelset' } });
  expect(response.ok()).toBe(true);
  await page.goto('/#/map');
  await expect(page.locator('.geo-attention')).toContainText(train.number);
  await page.getByRole('radio', {name:'Внимание',exact:true}).click();
  await expect(page.getByRole('button', {name:`Выбрать поезд №${train.number}`,exact:true})).toBeAttached();
  await page.locator('.geo-attention').getByRole('button').filter({hasText:train.number}).click();
  await expect(page.locator('.geo-details h2')).toHaveText(`Поезд №${train.number}`);
  await expect(page.locator('.geo-train-status')).toContainText('Остановлен из-за неисправности');
  const mapHeight=await page.locator('.geo-map').evaluate(el=>el.clientHeight);
  expect(await page.locator('.geo-details').evaluate(el=>el.clientHeight)).toBe(mapHeight);
  await page.getByRole('button', {name:'Карта на весь экран',exact:true}).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.classList.contains('geo-panel'))).toBe(true);
  await expect(page.getByRole('button', {name:'Выйти из полноэкранного режима',exact:true})).toBeVisible();
  await page.getByRole('button', {name:'Команды диспетчера',exact:true}).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBe(null);
  await expect(page.locator('#geo-dispatcher')).toHaveAttribute('open');
  await expect(page.locator('.dispatcher .tc-head')).toContainText(train.number);
  expect(errors).toEqual([]);
});
