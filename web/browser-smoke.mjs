import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'../.tools/web-tests/node_modules/playwright/index.mjs');
const output=new URL('../.tools/browser-validation/',import.meta.url);
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-proxy-server'],...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',error=>{errors.push(error.message);console.error('页面错误：',error.message);});
  page.on('dialog',dialog=>dialog.accept());
  await page.goto(process.env.TEST_URL||'http://127.0.0.1:8766/');
  await page.getByText('就绪 · 文件只在浏览器本地处理').waitFor();
  for(const category of ['技能','战斗','角色','职业','据点','采矿','商店','编队']){
    await page.locator('#categories').getByRole('button',{name:category+' ›',exact:true}).click();
    assert.match(await page.locator('#categories button.active').textContent(),new RegExp('^'+category));
    assert.equal(await page.locator('iframe:visible').count(),0,`${category}错误显示任务编排`);
  }
  await page.getByRole('button',{name:'任务编队',exact:true}).click();
  const frame=page.frameLocator('iframe');await frame.locator('.layout').waitFor();
  await frame.locator('.module-tools summary').click();
  await frame.getByRole('button',{name:'导入编辑 JSON / ZIP…',exact:true}).waitFor();
  await frame.locator('.module-tools summary').click();
  await page.screenshot({path:new URL('missions.png',output).pathname,fullPage:true});
  await page.locator('#categories').getByRole('button',{name:'职业 ›',exact:true}).click();
  assert.equal(await page.locator('iframe:visible').count(),0);
  await page.getByRole('button',{name:'默认装备',exact:true}).click();
  await frame.locator('.equiptype-cols').waitFor();
  assert.equal(await frame.getByRole('heading',{name:'关卡编队',exact:true}).count(),0);
  await page.screenshot({path:new URL('gear.png',output).pathname,fullPage:true});
  await page.locator('#categories').getByRole('button',{name:'战斗 ›',exact:true}).click();
  assert.equal(await page.locator('iframe:visible').count(),0);
  await page.getByLabel('启用此模块',{exact:true}).check();
  const exported=page.waitForEvent('download');await page.locator('#export').click();const file=await exported;
  assert.match(file.suggestedFilename(),/\.zip$/);await file.saveAs(new URL('mod.zip',output).pathname);
  await page.screenshot({path:new URL('battle.png',output).pathname,fullPage:true});
  await page.locator('#show-save').click();await page.getByRole('button',{name:'打开存档',exact:true}).waitFor();
  await page.locator('#show-mod').click();await page.locator('#target').selectOption('western');
  await page.getByRole('button',{name:'经验倍率',exact:true}).click();await page.getByLabel('经验倍率',{exact:true}).selectOption('2');await page.getByLabel('启用此模块',{exact:true}).check();
  const projectDownload=page.waitForEvent('download');await page.locator('#save-project').click();const saved=await projectDownload;await saved.saveAs(new URL('project.json',output).pathname);
  const project=JSON.parse(await readFile(new URL('project.json',output),'utf8'));
  project.missionEdits={equiptype_items:[{equiptype_id:1,item_col0_id:282,item_col1_id:283,item_col2_id:284}]};
  await writeFile(new URL('roundtrip.json',output),JSON.stringify(project));
  const chooserPromise=page.waitForEvent('filechooser');await page.locator('#import-project').click();await (await chooserPromise).setFiles(new URL('roundtrip.json',output).pathname);
  await page.getByText('完整工程已载入',{exact:true}).waitFor();
  const roundtripDownload=page.waitForEvent('download');await page.locator('#save-project').click();await (await roundtripDownload).saveAs(new URL('roundtrip-result.json',output).pathname);
  assert.deepEqual(JSON.parse(await readFile(new URL('roundtrip-result.json',output),'utf8')).missionEdits.equiptype_items,project.missionEdits.equiptype_items);
  const combinedDownload=page.waitForEvent('download');await page.locator('#export').click();await (await combinedDownload).saveAs(new URL('combined.zip',output).pathname);
  await page.getByText('已导出 3 个模块，字节冲突检查通过',{exact:true}).waitFor();
  const fixture=new Uint8Array(0x4da3a0);fixture.set(new TextEncoder().encode('UCSD'),4);fixture.fill(255,0x2af40,0x2af40+500*464);fixture.fill(255,0x1b5830,0x1b5830+164*1316);
  await writeFile(new URL('fixture.DAT',output),fixture);await page.locator('#show-save').click();
  const saveChooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'打开存档',exact:true}).click();await (await saveChooser).setFiles(new URL('fixture.DAT',output).pathname);
  await page.getByLabel('金币',{exact:true}).fill('123456');await page.getByLabel('声望',{exact:true}).click();
  const saveDownload=page.waitForEvent('download');await page.getByRole('button',{name:'下载修改后存档',exact:true}).click();await (await saveDownload).saveAs(new URL('edited.DAT',output).pathname);
  assert.equal((await readFile(new URL('edited.DAT',output))).readUInt32LE(0x20),123456);
  assert.equal((await readFile(new URL('fixture.DAT',output))).readUInt32LE(0x20),0);
  await page.locator('#show-mod').click();
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:new URL('mobile.png',output).pathname,fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,'手机页面横向溢出');
  for(const [category,view,selector] of [['编队','任务编队','.layout'],['职业','默认装备','.equiptype-cols']]){
    await page.locator('#categories').getByRole('button',{name:new RegExp('^'+category)}).click();await page.getByRole('button',{name:view,exact:true}).click();await frame.locator(selector).waitFor();
    await page.screenshot({path:new URL(view==='任务编队'?'mobile-missions.png':'mobile-gear.png',output).pathname,fullPage:true});
    const overflow=await frame.locator('body').evaluate(()=>[...document.querySelectorAll('body *')].filter(node=>node.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(node=>({tag:node.tagName,class:node.className,width:node.getBoundingClientRect().width})));
    assert.deepEqual(overflow,[],`${view}手机内页横向溢出`);
  }
  assert.deepEqual(errors,[]);console.log('浏览器验证通过：八分类隔离、单iframe切换、任务/默认装备、统一导出、工程保存、版本切换、移动布局。');
}finally{await browser.close();}
