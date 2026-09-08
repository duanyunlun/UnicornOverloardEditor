import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'../.tools/web-tests/node_modules/playwright/index.mjs');
const output=new URL('../.tools/browser-validation/style-audit/',import.meta.url);await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-proxy-server'],...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
const findings=[],errors=[];let screens=0;
try{
  for(const [width,height,language,colorScheme] of [[1440,900,'zh-CN','light'],[1024,768,'en-US','light'],[390,844,'zh-CN','light'],[1440,900,'ja-JP','dark']]){
    const page=await browser.newPage({viewport:{width,height},colorScheme});page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    await page.goto(process.env.TEST_URL||'http://127.0.0.1:4181/');await page.locator('#categories button').first().waitFor();await page.locator('#language').selectOption(language);
    const capture=async(name)=>{
      for(const frame of page.frames()){
        const overflow=await frame.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,controls:[...document.querySelectorAll('button,input,select,textarea')].filter(node=>{const bounds=node.getBoundingClientRect(),panel=node.closest('.panel')?.getBoundingClientRect();return bounds.width>0&&!node.closest('nav,.tabs,.combo-pop')&&(bounds.width>innerWidth||bounds.right>innerWidth+1&&bounds.left>=0||panel&&bounds.right>panel.right+1);}).slice(0,8).map(node=>({text:node.textContent.slice(0,40),class:node.className}))}));
        if(overflow.scroll>overflow.width+1||overflow.controls.length)findings.push({width,language,name,frame:frame===page.mainFrame()?'outer':'inner',...overflow});
        const alignment=await frame.evaluate(()=>{
          const issues=[];
          for(const trigger of document.querySelectorAll('button')){
            if(trigger.matches('.ref-toggle,.linkish'))continue;
            const bounds=trigger.getBoundingClientRect(),children=[...trigger.childNodes].flatMap(child=>{
              if(child.nodeType===Node.TEXT_NODE&&!child.textContent.trim())return [];
              if(child.nodeType===Node.TEXT_NODE){const range=document.createRange();range.selectNodeContents(child);return [...range.getClientRects()];}
              return child.nodeType===Node.ELEMENT_NODE?[child.getBoundingClientRect()]:[];
            }).filter(rect=>rect.height);
            if(!bounds.height||!children.length)continue;
            const style=getComputedStyle(trigger),center=(bounds.top+bounds.bottom+parseFloat(style.borderTopWidth)-parseFloat(style.borderBottomWidth))/2;
            const offset=Math.abs((Math.min(...children.map(rect=>rect.top))+Math.max(...children.map(rect=>rect.bottom)))/2-center);
            if(offset>2)issues.push({control:trigger.className,text:trigger.textContent.slice(0,35),offset});
            if(style.textAlign==='center'&&style.justifyContent==='center'&&style.flexDirection==='row'){
              const horizontal=Math.abs((Math.min(...children.map(rect=>rect.left))+Math.max(...children.map(rect=>rect.right))-bounds.left-bounds.right)/2);
              if(horizontal>2)issues.push({control:trigger.className,text:trigger.textContent.slice(0,35),horizontal});
            }
          }
          for(const row of document.querySelectorAll('.gear-slot-row')){
            const trigger=row.querySelector('.combo-trigger')?.getBoundingClientRect(),clear=row.querySelector('.gear-clear')?.getBoundingClientRect();
            if(trigger?.height&&clear?.height){const offset=Math.abs((trigger.top+trigger.bottom-clear.top-clear.bottom)/2);if(offset>1)issues.push({control:'gear-clear',offset});}
          }
          return issues;
        });
        if(alignment.length)findings.push({width,language,name,alignment});
      }
      await page.screenshot({path:new URL(`${width}-${language}-${name}.png`,output).pathname,fullPage:true});
      screens++;
    };
    for(let category=0;category<8;category++){
      await page.locator('#categories button').nth(category).click();const count=await page.locator('#module-tabs button').count();
      for(let tab=0;tab<Math.max(1,count);tab++){
        if(count)await page.locator('#module-tabs button').nth(tab).click();
        assert.equal(await page.locator('#module-panel .card[data-module] > details').count(),0,'所有模块不应显示补丁查看入口');
        for(const head of await page.locator('#module-panel .card[data-module] > .card-head').all()){
          const title=await head.locator('h3').boundingBox(),toggle=await head.locator('.toggle').boundingBox();
          if(title&&toggle){
            const offset=Math.abs(title.y+title.height/2-toggle.y-toggle.height/2);
            if(width>=1024)assert.ok(offset<2,'模块标题和开关应垂直居中');
            if(offset<2)assert.ok(Math.abs(toggle.x-title.x-title.width-20)<1,'模块开关应紧邻标题，间距20px');
          }
        }
        for(const select of await page.locator('.battle-settings select').all())assert.ok((await select.boundingBox()).width<240,'普通战斗下拉框不应拉伸铺满');
        if(await page.locator('#mission-host').isVisible()){
          const frame=page.frameLocator('iframe'),view=category===3?(tab===1?2:4):(tab===1?1:3);
          await frame.locator(`.view-tabs button:nth-child(${view}).active`).waitFor({state:'attached'});await frame.locator('.panel').first().waitFor();
          if(category===3||tab===2)await frame.locator('.list button').nth(1).click();
          if(category===7&&tab===1&&await frame.locator('.formation-cell.occupied').count())await frame.locator('.formation-cell.occupied').first().click();
        }
        await capture(`mod-${category}-${tab}`);
        if(width===1440&&language==='zh-CN'){
          const surface=await page.locator('#mission-host').isVisible()?page.frameLocator('iframe').locator('.panel.wide'):page.locator('#module-panel');
          for(const [label,fraction] of [['middle',.5],['bottom',1]]){await surface.evaluate((node,fraction)=>{node.scrollTop=(node.scrollHeight-node.clientHeight)*fraction;},fraction);await capture(`mod-${category}-${tab}-${label}`);}
          await surface.evaluate(node=>{node.scrollTop=0;});
          const scope=await page.locator('#mission-host').isVisible()?page.frameLocator('iframe').locator('.app'):page.locator('#module-panel');
          const details=scope.locator('details:not([open])');const count=await details.count();
          await details.evaluateAll(nodes=>nodes.forEach(node=>node.open=true));await capture(`mod-${category}-${tab}-expanded`);
          if(count)await scope.locator('details[open]').evaluateAll(nodes=>nodes.forEach(node=>node.open=false));
        }
        if(await page.locator('#mission-host').isVisible()){
          const frame=page.frameLocator('iframe'),combo=frame.locator('.panel.wide .combo').last();
          if(await combo.count()){
            await combo.locator('.combo-trigger').click();const popup=combo.locator('.combo-pop');await popup.waitFor();
            const bounds=await popup.boundingBox(),frameBounds=await page.locator('iframe').boundingBox();
            assert.ok(bounds.width>100&&bounds.height>70,'下拉菜单必须有可用空间');
            assert.ok(bounds.y>=frameBounds.y-1&&bounds.y+bounds.height<=frameBounds.y+frameBounds.height+1,`${width}/${category}/${tab} 下拉菜单被视口裁切`);
            await page.screenshot({path:new URL(`${width}-${language}-popup-${category}-${tab}.png`,output).pathname});
            screens++;
            const selected=combo.locator('.combo-option.active');if(await selected.count())await selected.click();else await combo.locator('.combo-search').press('Escape');
          }
        }
      }
    }
    await page.locator('#show-save').click();await capture('save-empty');
    const fixture=new Uint8Array(0x4da3a0);fixture.set(new TextEncoder().encode('UCSD'),4);fixture.fill(255,0x2af40,0x2af40+500*464);fixture.fill(255,0x1b5830,0x1b5830+164*1316);fixture.fill(0,0x2af40,0x2af40+464);fixture[0x2af40+40]=3;fixture[0x2af40+60]=1;for(let unit=0;unit<10;unit++)fixture[0x10d89a+unit*1720]=5;
    const data=new DataView(fixture.buffer);for(const [index,id] of [8,9,282,283].entries()){data.setUint32(0xa0+index*20,id,true);data.setUint32(0xa4+index*20,index+1,true);fixture[0xa8+index*20]=index<2?1:0;}
    const chooser=page.waitForEvent('filechooser');await page.locator('#save-workspace button').first().click();await(await chooser).setFiles({name:'layout.DAT',mimeType:'application/octet-stream',buffer:Buffer.from(fixture)});
    await page.locator('#save-workspace .tabs').waitFor();
    for(let tab=0;tab<5;tab++){
      await page.locator('#save-workspace .tabs button').nth(tab).click();if(tab===4)assert.equal(await page.locator('#save-workspace .grid > .card h3:visible').count(),10);await capture(`save-${tab}`);
      await page.locator('#save-workspace details').evaluateAll(nodes=>nodes.forEach(node=>node.open=true));await capture(`save-${tab}-expanded`);
      await page.locator('#save-workspace').evaluate(node=>{node.scrollTop=node.scrollHeight;});await capture(`save-${tab}-bottom`);
      await page.locator('#save-workspace').evaluate(node=>{node.scrollTop=0;});
    }
    await page.close();
  }
  await writeFile(new URL('findings.json',output),JSON.stringify({findings,errors},null,2));
  console.log(JSON.stringify({screens,findings,errors},null,2));
  assert.deepEqual(errors,[]);
  if(process.env.AUDIT_STRICT==='1')assert.deepEqual(findings,[]);
}finally{await browser.close();}
