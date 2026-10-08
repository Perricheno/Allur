import {test,expect} from '@playwright/test';
test('question runs real isolated simulation, focuses outage, exposes script, comparison and separate window',async({page,request,context})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));const before=await(await request.get('/api/state')).json();
 await page.goto('/ai.html');await expect(page.locator('canvas[data-ready=true]')).toBeVisible();
 await page.getByRole('textbox').fill('Остановить окраску на 40 минут и добавить 8 сборщиков.');await page.getByRole('button',{name:'Запустить анализ'}).click();
 await expect(page.locator('.agent-progress')).toContainText('Выполняем симуляцию');
 await expect(page.locator('.lab-callout')).toContainText('остановлена');
 await expect(page.locator('.lab-areas button')).toHaveCount(6);
 await expect(page.getByRole('heading',{name:'Результат решения'})).toBeVisible();
 await expect(page.locator('.agent-answer')).toContainText('Остановка окраски ограничивает поток');
 await page.getByText('Параметры и исполняемый сценарий',{exact:true}).click();await expect(page.locator('.agent-plan code')).toContainText('failure');
 await expect(page.locator('.impact-grid article')).toHaveCount(6);
 const id=new URL(page.url()).searchParams.get('run');const job=await(await request.get('/api/agent/jobs/'+id)).json();expect(job.frames).toHaveLength(101);expect(job.result.results).toHaveLength(2);
 expect((await(await request.get('/api/state')).json()).revision).toBe(before.revision);
 await page.locator('.lab-areas button').filter({hasText:'Сборка'}).click();await page.getByRole('tab',{name:'Сотрудники'}).click();await expect(page.locator('.staff-ring strong')).toHaveText('40');
 await page.getByRole('button',{name:'Без изменений',exact:true}).click();await expect(page.locator('.staff-ring strong')).toHaveText('32');
 await page.getByRole('button',{name:'Повторить симуляцию'}).click();await expect(page.getByRole('button',{name:'Пауза повтора'})).toBeVisible();
 await page.getByRole('button',{name:'Пауза повтора'}).click();await page.getByRole('slider').fill('0');await expect(page.locator('.lab-sim-clock')).toContainText('+00:00');
 await page.screenshot({path:'test-results/dtai-tested-desktop.png',fullPage:true});
 const popupPromise=context.waitForEvent('page');await page.getByRole('link',{name:'Отдельное окно ↗'}).click();const popup=await popupPromise;await expect(popup.locator('canvas[data-ready=true]')).toBeVisible();await expect(popup.getByRole('heading',{name:'Результат решения'})).toBeVisible();await popup.close();
 await page.reload();await expect(page.getByRole('heading',{name:'Результат решения'})).toBeVisible();expect(errors).toEqual([]);
});
test('phone navigation, live workshop details, readable tabs and no time acceleration',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:390,height:844});await page.goto('/?mode=live#/factory/paint');await expect(page.locator('canvas[data-ready=true]')).toBeVisible();
 await expect(page.getByRole('combobox',{name:/Скорость/})).toHaveCount(0);await expect(page.getByRole('button',{name:'+10 мин',exact:true})).toHaveCount(0);
 await expect(page.locator('.area-passport')).toContainText('Эффективность OEE');await page.getByRole('tab',{name:'Сотрудники'}).click();await expect(page.locator('.staff-ring strong')).toHaveText('16');await page.getByRole('tab',{name:'Оборудование',exact:true}).click();await expect(page.locator('.area-passport')).toContainText('Синтетические значения');await page.getByRole('tab',{name:'Ресурсы'}).click();await expect(page.locator('.area-passport')).toContainText('Покрытие, л');
 await page.getByRole('tab',{name:'Сотрудники'}).click();await page.screenshot({path:'test-results/detail-mobile.png',fullPage:true});
 await page.getByRole('link',{name:'Проверить изменение штата в DTAI ↗'}).click();await expect(page.getByRole('textbox')).toHaveValue(/добавить 4 сотрудника/);
 for(const width of [320,390,768]){await page.setViewportSize({width,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();}
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/dtai-tested-mobile.png',fullPage:true});
 await page.getByRole('navigation',{name:'Мобильная навигация'}).getByRole('link',{name:'3D-завод',exact:true}).click();await expect(page).toHaveURL(/factory\/paint$/);expect(errors).toEqual([]);
});
