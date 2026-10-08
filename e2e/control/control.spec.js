import { test, expect } from '@playwright/test';
const command = async (request, data) => { const r = await request.post('/api/actions', { data }); expect(r.ok()).toBeTruthy(); return r.json(); };
test.beforeEach(async ({ request }) => { await command(request, { type: 'reset', seed: 4817 }); });

test('manager workflow: factors, outage, acknowledgment, comparison and exports', async ({page,request}) => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/control.html');
  await expect(page.getByRole('heading',{name:'Производственный поток'})).toBeVisible();
  await page.getByRole('link',{name:'Параметры',exact:true}).click();
  const factor=page.getByRole('spinbutton',{name:'lines.paint.staffAvailable',exact:true});
  await factor.fill('10');await page.getByRole('button',{name:'Применить параметры'}).click();
  await expect(page.getByText('Изменения сохранены',{exact:true})).toBeVisible();
  expect((await (await request.get('/api/state')).json()).configuration.lines.paint.staffAvailable).toBe(10);
  await page.getByRole('link',{name:'Инциденты',exact:true}).click();
  await page.getByRole('button',{name:'Остановить оборудование'}).click();
  await expect(page.getByRole('button',{name:'Принять в работу'})).toBeVisible();
  await page.getByPlaceholder('Например: передано ремонтной бригаде').fill('Проверка ремонтной бригады');
  await page.getByRole('button',{name:'Принять в работу'}).click();
  await expect(page.getByText('Принят',{exact:true})).toBeVisible();
  expect((await (await request.get('/api/state')).json()).areas.find(a=>a.id==='paint').condition.repair).not.toBeNull();
  await command(request,{type:'step',seconds:600});
  await page.getByRole('link',{name:'Прогноз и сценарии',exact:true}).click();
  await page.getByLabel('Горизонт',{exact:true}).selectOption('1');
  await page.getByLabel('Прогонов на вариант').selectOption('1');
  const before=(await (await request.get('/api/state')).json()).revision;
  await page.getByRole('button',{name:'Рассчитать и сравнить'}).click();
  await expect(page.getByRole('heading',{name:'Результаты сравнения'})).toBeVisible();
  await expect(page.locator('.forecast-result')).toHaveCount(3);
  expect((await (await request.get('/api/state')).json()).revision).toBe(before);
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Скачать JSON',exact:true}).click();expect((await downloadPromise).suggestedFilename()).toBe('allur-scenarios.json');
  await page.screenshot({path:'test-results/control-scenarios.png',fullPage:true});
  await page.getByRole('link',{name:'Мониторинг',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Показатели всех участков'})).toBeVisible();
  await expect(page.getByText('Восстановить участок «Окраска»')).toBeVisible();
  await page.screenshot({path:'test-results/control-desktop.png',fullPage:true});
  expect(errors).toEqual([]);
});

test('case demos require explicit replacement; shortage recovers after delivery', async ({page,request}) => {
  await page.goto('/control.html#case');
  const demo=page.locator('.demo-grid article').filter({hasText:'Дефицит колёс и поставка'});
  await demo.getByRole('button',{name:'Подготовить демонстрацию'}).click();
  expect((await (await request.get('/api/state')).json()).clock.elapsedSeconds).toBe(0);
  await page.getByRole('button',{name:'Заменить прогон и начать'}).click();
  await expect(page.getByRole('heading',{name:'Мониторинг',exact:true})).toBeVisible();
  let s=await (await request.get('/api/state')).json();expect(s.clock.running).toBe(false);expect(s.areas.find(a=>a.id==='assembly').status).toBe('material_shortage');
  const completed=s.areas.find(a=>a.id==='assembly').stats.completed;
  await page.getByRole('button',{name:'Добавить поставку'}).click();
  await expect.poll(async()=> (await (await request.get('/api/state')).json()).inventory.wheels).toBe(80);
  await command(request,{type:'step',seconds:600});
  await expect.poll(async()=> (await (await request.get('/api/state')).json()).areas.find(a=>a.id==='assembly').stats.completed).toBeGreaterThan(completed);
  for(const id of ['brief','data']) {const r=await request.get('/api/case/files/'+id);expect(r.headers()['content-type']).toBe('application/pdf');expect((await r.body()).subarray(0,4).toString()).toBe('%PDF');}
});

test('mobile sections fit viewport and retain navigation',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:390,height:844});
  for(const tab of ['overview','incidents','scenarios','factors','case']){
    await page.goto('/control.html#'+tab);await expect(page.locator('.pipeline .area-tile')).toHaveCount(6);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  }
  await page.screenshot({path:'test-results/control-mobile.png',fullPage:true});expect(errors).toEqual([]);
});

test('3D production mode reports the backend outage and unit progress',async({page,request})=>{
  await command(request,{type:'demo',id:'cascade'});await command(request,{type:'step',seconds:60});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/?mode=live#/factory/paint');
  await expect(page.locator('canvas[data-ready=true]')).toBeVisible();
  await expect(page.locator('.building-label[data-status=down]')).toHaveCount(1);
  await expect(page.locator('.live-area-card')).toContainText('Остановлен');
  await expect(page.getByRole('checkbox',{name:'Состояние модели в 3D'})).toBeChecked();
  await page.getByRole('checkbox',{name:'Состояние модели в 3D'}).uncheck();
  await expect(page.locator('.building-label[data-status]')).toHaveCount(0);
  await expect(page.locator('.operation-card')).toBeVisible();expect(errors).toEqual([]);
});

test('phone navigation returns to the selected workshop and clocks keep real time on pause', async ({page,request}) => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width:390,height:844});await page.goto('/?mode=live#/factory/paint');
  await expect(page.locator('canvas[data-ready=true]')).toBeVisible();
  await page.getByRole('combobox',{name:'Участок завода'}).selectOption('assembly');
  await expect(page).toHaveURL(/factory\/assembly$/);
  await page.getByRole('button',{name:'Внутри цехов',exact:true}).click();
  await page.locator('.factory-quick-links').getByRole('link',{name:'Центр управления'}).click();
  await expect(page.getByRole('heading',{name:'Мониторинг',exact:true})).toBeVisible();
  const real=page.locator('.real-clock time'),before=await real.textContent();
  const model=await page.locator('.server-clock strong').textContent();
  await expect(real).not.toHaveText(before);await expect(page.locator('.server-clock strong')).toHaveText(model);
  expect(Math.abs(Date.parse(await real.getAttribute('datetime'))-Date.now())).toBeLessThan(5000);
  const nav=page.getByRole('navigation',{name:'Мобильная навигация'});
  await nav.getByRole('button',{name:'Ещё'}).click();await nav.getByRole('link',{name:'Прогноз',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Прогноз и сценарии',exact:true})).toBeVisible();
  await nav.getByRole('button',{name:'Ещё'}).click();await nav.getByRole('link',{name:'Параметры модели'}).click();
  await expect(page.getByRole('heading',{name:/параметров модели/})).toBeVisible();
  await nav.getByRole('link',{name:'3D-завод',exact:true}).click();
  await expect(page).toHaveURL(/mode=live#\/factory\/assembly$/);
  await expect(page.getByRole('combobox',{name:'Участок завода'})).toHaveValue('assembly');
  await expect(page.getByRole('button',{name:'Внутри цехов',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('button',{name:'Приблизить',exact:true})).toBeInViewport();
  await expect(page.locator('canvas[data-ready=true]')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.screenshot({path:'test-results/phone-factory.png'});
  expect(errors).toEqual([]);
});

test('saved forecast returns after reload and the mobile controls fit narrow screens',async({page,request})=>{
  const job=await (await request.post('/api/scenarios/compare',{data:{variants:['power-limit'],horizonSeconds:3600,seeds:[7]}})).json();
  await expect.poll(async()=>(await (await request.get(job.url)).json()).status).toBe('completed');
  await page.setViewportSize({width:390,height:844});await page.goto('/control.html#scenarios');
  await expect(page.getByRole('heading',{name:'Результаты сравнения'})).toBeVisible();
  await expect(page.getByRole('combobox',{name:'Архив расчётов'})).toHaveValue(job.id);
  const result=await page.locator('.forecast-results').textContent();
  await page.reload();await expect(page.locator('.forecast-results')).toHaveText(result);
  await expect(page.getByRole('combobox',{name:'Архив расчётов'})).toHaveValue(job.id);
  for(const width of [320,390,768]){
    await page.setViewportSize({width,height:844});
    for(const tab of ['overview','incidents','scenarios','factors','case']){
      await page.goto('/control.html#'+tab);await expect(page.locator('.pipeline .area-tile')).toHaveCount(6);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width} ${tab}`).toBeTruthy();
    }
  }
  await page.setViewportSize({width:390,height:844});await page.goto('/control.html#overview');
  await expect(page.getByRole('heading',{name:'Производственный поток'})).toBeVisible();
  await page.screenshot({path:'test-results/phone-monitoring.png'});
  await page.getByRole('navigation',{name:'Мобильная навигация'}).getByRole('button',{name:'Ещё'}).click();
  await page.screenshot({path:'test-results/phone-menu.png'});
});
