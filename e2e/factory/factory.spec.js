import { test, expect } from '@playwright/test';

test('factory renders, opens a workshop, pauses and filters equipment', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?mode=demo');
  await expect(page.locator('canvas[data-ready="true"]')).toBeVisible();
  await expect(page.locator('.building-label')).toHaveCount(6);
  await page.getByRole('button', { name: 'Приостановить движение', exact: true }).click();
  const clock = await page.locator('.model-clock time').textContent();
  await page.waitForTimeout(1200);
  await expect(page.locator('.model-clock time')).not.toHaveText(clock);
  await page.screenshot({ path: 'test-results/factory-desktop.png' });
  await page.getByRole('button', { name: 'Заглянуть в цех сборки' }).click();
  await expect(page).toHaveURL(/#\/factory\/assembly$/);
  await expect(page.locator('h2')).toHaveText('Сборка автомобилей');
  await expect(page.getByRole('button', { name: 'Показать крышу' })).toBeVisible();
  await expect(page.locator('.report-output')).toContainText('119');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'test-results/factory-interior.png' });
  await page.getByRole('button', { name: 'Показать крышу' }).click();
  await expect(page.getByRole('button', { name: 'Открыть цех', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Общий вид завода', exact: true }).click();
  await expect(page.locator('.area-list button')).toHaveCount(6);
  await page.getByRole('button', { name: 'Оборудование', exact: true }).click();
  await page.getByRole('textbox', { name: 'Поиск оборудования' }).fill('ABB-04');
  await expect(page.locator('.equipment-list button')).toHaveCount(1);
  await page.locator('.equipment-list button').click();
  await expect(page.locator('h2')).toHaveText('Сварка кузовов');
  await page.getByRole('button', { name: 'Продолжить движение' }).click();
  await expect(page.locator('.model-clock time')).not.toHaveText(clock);
  expect(errors).toEqual([]);
});

test('mobile layout and workshop deep link', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/factory/paint');
  await expect(page.locator('canvas[data-ready="true"]')).toBeVisible();
  await expect(page.locator('h2')).toHaveText('Окраска');
  await page.getByRole('button', { name: 'Общий вид завода', exact: true }).click();
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/factory-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Настройки отображения' }).click();
  await page.getByRole('checkbox', { name: 'Названия участков' }).uncheck();
  await expect(page.locator('.building-label:visible')).toHaveCount(0);
});

test('all six workshops have distinct, repeatable animated operations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?mode=demo');
  await expect(page.locator('canvas[data-ready="true"]')).toBeVisible();
  const result = await page.evaluate(async () => {
    const THREE = await import('three');
    const { createFactory } = await import('/js/factory/geometry.js');
    const { AREAS } = await import('/js/factory/data.js');
    const factory = createFactory(new THREE.Scene());
    const groups = AREAS.map(a => factory.root.getObjectByName(`workshop-${a.id}`));
    const fingerprint = group => {
      const state = [];
      group.traverse(o => state.push([o.position.toArray(), o.rotation.toArray(), o.scale.toArray(), o.visible]));
      return JSON.stringify(state);
    };
    const checks = AREAS.map((a, i) => {
      factory.select(a.id, true);
      factory.animate(0); const before = fingerprint(groups[i]);
      factory.animate(6); const during = fingerprint(groups[i]);
      factory.animate(6); const repeated = fingerprint(groups[i]);
      return { id: a.id, changed: before !== during, repeatable: during === repeated, visible: groups.filter(g => g.visible).length };
    });
    factory.select(null, true); const allOpen = groups.every(g => g.visible);
    factory.select(null, false); const allClosed = groups.every(g => !g.visible);
    factory.select('assembly', true);
    const trackedCar = factory.root.getObjectByName('assembly-car-0');
    const componentIds = ['powertrain', 'interior', 'wheels', 'glazing', 'finish'];
    const build = componentIds.map((_, stage) => {
      factory.animate(stage * 12 + 8);
      return componentIds.filter(id => trackedCar.getObjectByName(id).visible);
    });
    factory.dispose();
    return { checks, allOpen, allClosed, build };
  });
  expect(result.checks).toHaveLength(6);
  for (const check of result.checks) {
    expect(check.changed, `${check.id} must animate`).toBe(true);
    expect(check.repeatable, `${check.id} must stay still at a fixed time`).toBe(true);
    expect(check.visible).toBe(1);
  }
  expect(result.allOpen).toBe(true);
  expect(result.allClosed).toBe(true);
  const components = ['powertrain', 'interior', 'wheels', 'glazing', 'finish'];
  result.build.forEach((parts, stage) => expect(parts).toEqual(components.slice(0, stage + 1)));
});

test('assembly stage inspection preserves components and pauses playback', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?mode=demo#/factory/assembly');
  await expect(page.locator('canvas[data-ready="true"]')).toBeVisible();
  await page.getByRole('button', { name: 'Открыть цех', exact: true }).click();
  await expect(page.locator('.assembly-dock')).toBeVisible();
  await page.getByRole('button', { name: 'Рассмотреть этап: Силовой узел', exact: true }).click();
  await expect(page.locator('.passport-progress strong')).toHaveText('1 / 5');
  await expect(page.getByRole('button', { name: 'Вся линия', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Рассмотреть этап: Колёса и тормоза', exact: true }).click();
  await expect(page.locator('.passport-progress strong')).toHaveText('3 / 5');
  await expect(page.locator('.part-check.installed')).toHaveCount(3);
  await page.getByRole('button', { name: 'Рассмотреть этап: Финальная сборка', exact: true }).click();
  await expect(page.locator('.passport-progress strong')).toHaveText('5 / 5');
  const paused = await page.locator('.passport-progress strong').textContent();
  await page.waitForTimeout(1100);
  await expect(page.locator('.passport-progress strong')).toHaveText(paused);
  await page.screenshot({ path: 'test-results/assembly-finished.png' });
  await page.getByRole('button', { name: 'Вся линия', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Следить за A-01', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.assembly-dock')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Рассмотреть этап: Салон и проводка', exact: true }).click();
  await expect(page.locator('.passport-progress strong')).toHaveText('2 / 5');
  await expect(page.locator('.vehicle-label')).toBeVisible();
  await page.screenshot({ path: 'test-results/assembly-mobile.png' });
});
