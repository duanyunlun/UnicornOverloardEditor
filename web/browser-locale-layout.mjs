import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'../.tools/web-tests/node_modules/playwright/index.mjs');
const output=new URL('../.tools/browser-validation/',import.meta.url);await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-proxy-server'],...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  await page.goto(process.env.TEST_URL||'http://127.0.0.1:8766/');await page.locator('#categories button').first().waitFor();
  const recordPicker=page.locator('.record-picker select').last();
  await recordPicker.selectOption('32');
  await page.locator('#module-panel input[type=number]').nth(1).fill('123');
  for(const language of ['en-US','ja-JP','zh-CN']){
    await page.locator('#language').selectOption(language);
    assert.equal(await recordPicker.inputValue(),'32','切换语言应保留选中记录');
    assert.equal(await page.locator('#module-panel input[type=number]').nth(1).inputValue(),'123');
    const suffix={'zh-CN':'cn','en-US':'en','ja-JP':'ja'}[language];
    const descriptions=await readFile(new URL('./info/skilldesc-'+suffix+'.txt',import.meta.url),'utf8');
    const expected=Buffer.from(descriptions.split(/\r?\n/).find(line=>line.startsWith('32\t')).split('\t')[1],'base64').toString('utf8');
    assert.equal(await page.locator('#module-panel p[data-no-translate]').textContent(),expected,'游戏说明必须保持对应语种原文');
  }
  await page.locator('#categories button').nth(5).click();
  await page.locator('#language').selectOption('en-US');
  assert.equal(await page.locator('#module-panel .field option[value="65"]').textContent(),'65 · Fevrite');
  assert.equal(await page.locator('#module-panel .field option[value="115"]').textContent(),'115 · Iron Ore');
  await page.locator('#language').selectOption('zh-CN');
  await page.locator('#categories button').nth(3).click();await page.locator('#module-tabs button').nth(1).click();
  const frame=page.frameLocator('iframe');await frame.locator('.catalog-layout').waitFor();
  const left=frame.locator('.catalog-layout > .panel').first(),right=frame.locator('.catalog-layout > .panel').last();
  const top=(await right.boundingBox()).y;
  await left.locator('.list button').nth(68).click();
  await right.getByRole('heading',{name:'桀纣霸主',exact:true}).waitFor();
  assert.ok(Math.abs((await right.boundingBox()).y-top)<2,'滚动职业列表不应移动详情');
  assert.ok(await left.evaluate(node=>node.scrollTop>0));
  await right.locator('input[type=number]').first().fill('7');await right.getByRole('heading').click();
  for(const [language,heading] of [['en-US','Overlord'],['ja-JP','オーバーロード'],['zh-CN','桀纣霸主']]){
    await page.locator('#language').selectOption(language);await right.getByRole('heading',{name:heading,exact:true}).waitFor();
    assert.equal(await right.locator('input[type=number]').first().inputValue(),'7');
    await page.screenshot({path:new URL('class-'+language+'.png',output).pathname});
  }
  await left.locator('.search').fill('领主');assert.ok(await left.locator('.list button').count()>0);
  await left.locator('.search').fill('');
  const download=page.waitForEvent('download');await page.locator('#save-project').click();await(await download).saveAs(new URL('locale-project.json',output).pathname);
  const project=JSON.parse(await readFile(new URL('locale-project.json',output),'utf8'));assert.equal(project.missionEdits.class_tactics[0].class_id,68);
  assert.ok(project.missionEdits.class_tactics[0].lines.some(line=>line.learn_lv===7||line.learn_level===7||line.level===7));
  await right.evaluate(node=>{node.scrollTop=node.scrollHeight;});
  await left.locator('.list button').nth(73).click();
  await right.getByRole('heading',{name:'暗黑侯爵',exact:true}).waitFor();
  assert.equal(await right.evaluate(node=>node.scrollTop),0,'选择新职业应从详情顶部显示');
  await page.locator('#categories button').nth(7).click();await page.locator('#module-tabs button').nth(1).click();await frame.locator('.layout').waitFor();
  const panels=frame.locator('.layout > .panel'),detail=panels.last();const detailTop=(await detail.boundingBox()).y;
  await panels.first().locator('.list button').last().click();
  assert.ok(Math.abs((await detail.boundingBox()).y-detailTop)<2,'滚动关卡列表不应移动详情');
  assert.ok(await panels.first().evaluate(node=>node.scrollTop>0));
  await page.screenshot({path:new URL('mission-independent-scroll.png',output).pathname});
  for(const tab of ['missions','gear']){
    if(tab==='gear'){await page.locator('#categories button').nth(3).click();await page.locator('#module-tabs button').nth(2).click();}
    for(const [language,title] of [['zh-CN','清空此装备槽'],['en-US','Clear this equipment slot'],['ja-JP','この装備枠を空にする']]){
      await page.locator('#language').selectOption(language);
      const buttons=frame.locator('.gear-clear');await frame.locator(`.gear-clear[title="${title}"]`).first().waitFor();assert.ok(await buttons.count()>0);
      for(const button of await buttons.all()){assert.equal((await button.textContent()).trim(),'×');assert.equal(await button.getAttribute('title'),title);assert.ok(await button.getAttribute('aria-label'));}
    }
  }
  await page.locator('#categories button').nth(7).click();await page.locator('#module-tabs button').nth(1).click();
  for(const language of ['zh-CN','en-US','ja-JP']){
    await page.locator('#language').selectOption(language);await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.equal(await frame.locator('body').evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.ok((await panels.first().boundingBox()).height<=251);
    await page.screenshot({path:new URL('mission-mobile-'+language+'.png',output).pathname,fullPage:true});
  }
  assert.deepEqual(errors,[]);console.log('语言与布局验证通过：三语切换、职业名、编辑保留、名称搜索、独立滚动、手机布局。');
}finally{await browser.close();}
