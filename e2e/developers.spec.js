import { test, expect } from '@playwright/test';
test('developer metrics stream, pause, export and mobile layout', async ({page, request}) => {
  const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  await page.goto('/#/developers');
  await expect(page.getByRole('heading', {name:'Разработчикам', exact:true})).toBeVisible();
  await expect(page.getByRole('heading', {name:'Вычисления по подсистемам'})).toBeVisible();
  const first=await (await request.get('/api/developer-metrics')).json();
  await expect.poll(async()=> (await (await request.get('/api/developer-metrics')).json()).at).toBeGreaterThan(first.at);
  await page.getByRole('button',{name:'Пауза показаний'}).click();
  await expect(page.getByRole('status').filter({hasText:'Показания на паузе'})).toBeVisible();
  const download=page.waitForEvent('download'); await page.getByRole('button',{name:'Диагностика · JSON'}).click(); await download;
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'/tmp/ktz-developers-phone.png',fullPage:true});
  expect(errors).toEqual([]);
});
test('push status endpoints reject unknown credentials and foreign origins', async({request})=>{
  const result=await request.post('/api/push/test',{data:{}});expect(result.status()).toBe(400);
  const foreign=await request.post('/api/push/test',{headers:{Origin:'https://attacker.test'},data:{}});expect(foreign.status()).toBe(403);
  const metrics=await (await request.get('/api/developer-metrics')).json();
  expect(JSON.stringify(metrics)).not.toMatch(/privateKey|p256dh|endpoint/);
});
