import { test, expect } from '@playwright/test';

test('national dispatcher selects route and train, station post and phone stay usable', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/#/overview?route=ARK-AST');
  await expect(page.getByRole('heading', { name: 'Аркалык — Астана', level: 2 })).toBeVisible();
  await expect(page.locator('.trackmap')).toBeVisible();
  await page.locator('.trackmap .mtrain').first().click();
  await page.getByRole('button', { name: 'Паспорт поезда' }).click();
  await expect(page.getByRole('dialog', { name: /Поезд №/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.sp-tracks')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('route restriction is validated and produces a traceable plan revision', async ({ request }) => {
  const invalid = await request.post('/api/schedule-route-incident', { data: { routeId: 'invalid', dir: 'all', minutes: 60 } });
  expect(invalid.status()).toBe(400);
  const before = await (await request.get('/api/schedule')).json();
  const response = await request.post('/api/schedule-route-incident', { data: { routeId: 'ARK-AST', dir: 'fwd', minutes: 60 } });
  expect(response.ok()).toBe(true);
  const after = await response.json();
  expect(after.plan.revision).toBe((before.plan.revision || 0) + 1);
  expect(after.plan.constraints.at(-1).dir).toBe('fwd');
  expect(after.plan.executionEnabled).toBe(false);
});

test('home-screen app exposes KTZ icon and push opt-in without automatically asking permission', async ({ page, request }) => {
  const manifest = await request.get('/manifest.webmanifest');
  expect(manifest.headers()['content-type']).toContain('application/manifest+json');
  const app = await manifest.json(); expect(app.display).toBe('standalone'); expect(app.icons[0].src).toContain('ktz-emblem');
  const config = await (await request.get('/api/push/config')).json();
  expect(config.publicKey).toMatch(/^[A-Za-z0-9_-]+$/); expect(config.privateKey).toBeUndefined();
  expect((await request.post('/api/push/subscribe', { data: { endpoint: 'https://127.0.0.1' } })).status()).toBe(400);
  await page.goto('/#/log');
  await page.getByRole('button', { name: 'Установить / уведомления' }).click();
  await expect(page.getByRole('dialog', { name: 'КТЖ на главном экране' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Включить каждое событие' })).toBeVisible();
  expect(await page.evaluate(() => Notification.permission)).not.toBe('granted');
});
