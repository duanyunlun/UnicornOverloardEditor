const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'../.tools/web-tests/node_modules/playwright/index.mjs');
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const browser=await chromium.launch({headless:true,args:['--no-proxy-server'],...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
const page=await browser.newPage({viewport:{width:1440,height:900}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
try{
  await page.goto(process.env.TEST_URL||'http://127.0.0.1:8766/');
  await page.getByRole('button',{name:/^职业/}).click();
  await page.getByRole('button',{name:'默认装备',exact:true}).click();
  const frame=page.frameLocator('#mission-host iframe');
  await frame.locator('.equiptype-cols').waitFor();
  assert.equal(await page.locator('.page-heading').count(),0);
  assert.equal(await frame.locator('.module-tools').getAttribute('open'),null);
  assert.ok((await page.locator('#mission-host').boundingBox()).y<200);
  assert.ok((await frame.locator('.equiptype-cols').boundingBox()).y<400);
  await page.screenshot({path:'.tools/browser-validation/compact-desktop.png'});
  for(const language of ['en-US','ja-JP','zh-CN']){
    await page.locator('#language').selectOption(language);
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:`.tools/browser-validation/compact-mobile-${language}.png`,fullPage:true});
  }
  await page.setViewportSize({width:1440,height:900});
  await page.getByRole('button',{name:/^战斗/}).click();
  await page.getByRole('button',{name:'经验倍率',exact:true}).click();
  await page.getByLabel('经验倍率',{exact:true}).selectOption('2');
  await page.getByLabel('启用此模块').check();
  await page.getByRole('button',{name:'导出 MOD 包',exact:true}).click();
  await page.getByRole('status').filter({hasText:'选择原始 main'}).waitFor();
  const chooserPromise=page.waitForEvent('filechooser');await page.getByRole('button',{name:'选择原始 main',exact:true}).click();
  await (await chooserPromise).setFiles('.extracted/exefs-asia-v1.0.5/main.dec');
  await page.getByText('原始 main 已校验',{exact:true}).waitFor();
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'导出 MOD 包',exact:true}).click();
  const download=await downloadPromise;await download.saveAs('.tools/browser-validation/asia-runtime-web.zip');
  const zip=await readFile('.tools/browser-validation/asia-runtime-web.zip');
  const files=new Map();let offset=0;
  while(zip.readUInt32LE(offset)===0x04034b50){const size=zip.readUInt32LE(offset+18),names=zip.readUInt16LE(offset+26),extra=zip.readUInt16LE(offset+28),start=offset+30+names+extra;files.set(zip.subarray(offset+30,offset+30+names).toString(),zip.subarray(start,start+size));offset=start+size;}
  const manifest=JSON.parse(await readFile('web/asia-runtime-data.json','utf8'));
  assert.equal(createHash('sha256').update(files.get('unicorn_asia_merged/exefs/main')).digest('hex'),manifest.hashes['2:0']);
  assert.equal([...files.keys()].filter(name=>name.endsWith('.pchtxt')).length,0);
  assert.ok(!files.get('unicorn-mod-project.json').toString().includes('sourceSha'));
  await page.getByRole('button',{name:'存档编辑',exact:true}).click();
  await page.getByRole('button',{name:'MOD 制作',exact:true}).click();
  assert.equal(await page.locator('#selection-count').count(),1);
  assert.deepEqual(errors,[]);console.log('PASS: desktop/mobile layout, three languages, missing input, actual ZIP/main hash, workspace navigation');
}finally{await browser.close();}
