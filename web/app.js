import {TARGETS,rows,generateMod,validateConflicts,zipFiles} from './mod-engine.js';
import {mountSave,download} from './save.js';
import {isAsiaRuntime,validateAsiaSource,buildAsiaMain} from './asia-runtime.js';
import {configureTranslations,setLanguage,getLanguage,t,translateDom,localizedName} from './i18n.js';
const $=id=>document.getElementById(id);
const notify=(message,error=false)=>{$('status').textContent=t(message);$('status').className=error?'error':'';};
const definitions=[
  ['技能','ability_editor','技能数值','修改技能消耗、物理 / 魔法威力、命中与效果参数。'],
  ['战斗','battle_preview','战斗预览','调整战斗预测显示，不改变实际战斗结算。'],['战斗','battle_timer_freeze','冻结计时器','冻结关卡战斗计时器。'],['战斗','unlimited_battle_start','开战被动','解除开战被动的发动数量限制。'],['战斗','type_matchups','类型克制','分别调整三种类型克制倍率。'],['战斗','experience_scale','经验倍率','仅修改战斗经验，经验书和道具不受影响。'],['战斗','enemy_level_scale','动态等级','根据玩家队伍等级调整敌军，保留上游关卡下限与例外。'],
  ['角色','character_randomizer','角色随机化','教程五人以外的63名剧情角色加入顺序随机化。仅用于新游戏，全流程保持启用。'],
  ['职业','class_editor','成长与技能','修改十项成长率、AP / PP、主动和被动技能。'],['职业','classes','默认战术','职业技能习得等级与全局默认条件。'],['职业','gear','默认装备','全职业共享的默认装备表，按三个等级档编辑。'],
  ['据点','fort_editor','据点雇佣','63个据点、248个招募位置；只改职业，保留性别与附加类型。'],['采矿','mine_editor','采矿掉落','五个地区的63条原版掉落；藏宝图等一次性限制仍由游戏决定。'],['商店','shop_editor','商店库存','科尔尼亚25个武具店的211条记录。价格是该物品的全局价格，共享库存会影响其他地点。'],
  ['编队','six_member_units','六人编队','允许S级声望部队扩充到六人。卸载前必须撤下第六名成员。'],['编队','missions','任务编队','按任务编辑队伍成员、站位、装备与战术。'],['编队','presets','战术预设','编辑共享预设、创建新预设与私有复制。'],
];
let catalog,project={schema:1,target:'asia',modules:{}},category='技能',moduleKey='ability_editor',saveController;
let asiaSource;
const missionKeys=new Set(['missions','presets','classes','gear']);let missionFrame,frameReady=false;
const pendingRequests=new Map();
const recordSelections=new Map();
function ensureFrame(){if(!missionFrame){missionFrame=element('iframe',undefined,$('mission-host'));missionFrame.title=t('关卡、战术与默认装备编辑器');missionFrame.src=`./mission/?target=${project.target}&language=${getLanguage()}&view=${missionKeys.has(moduleKey)?moduleKey:'missions'}`;}return missionFrame;}
async function requestFrame(type,extra={}){
  ensureFrame();
  if(!frameReady)await new Promise((resolve,reject)=>{const deadline=Date.now()+20000;const timer=setInterval(()=>{if(frameReady){clearInterval(timer);resolve();}else if(Date.now()>deadline){clearInterval(timer);reject(Error('任务编辑器加载超时'));}},50);});
  return new Promise((resolve,reject)=>{const requestId=crypto.randomUUID();const timer=setTimeout(()=>{pendingRequests.delete(requestId);reject(Error('任务编辑器响应超时，未导出'));},120000);pendingRequests.set(requestId,{resolve,reject,timer});missionFrame.contentWindow.postMessage({type,requestId,target:project.target,...extra},location.origin);});
}
window.addEventListener('message',event=>{
  if(event.origin!==location.origin||event.source!==missionFrame?.contentWindow||!event.data)return;
  const message=event.data;if(message.type==='uo-ready'){frameReady=true;missionFrame.contentWindow.postMessage({type:'uo-language',language:getLanguage()},location.origin);missionFrame.contentWindow.postMessage({type:'uo-view',view:missionKeys.has(moduleKey)?moduleKey:'missions',target:project.target},location.origin);}
  if(message.type==='uo-navigate'&&missionKeys.has(message.view)){moduleKey=message.view;category=definitions.find(row=>row[1]===moduleKey)[0];render();}
  const request=pendingRequests.get(message.requestId);if(request){clearTimeout(request.timer);pendingRequests.delete(message.requestId);if(message.error)request.reject(Error(message.error));else request.resolve(message);}
});
const element=(tag,text,parent)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=t(text);parent?.append(node);return node;};
function button(parent,text,callback){const node=element('button',text,parent);node.onclick=async()=>{try{await callback();}catch(error){notify(error.message,true);}};return node;}
const lookup=(filename,id)=>rows(catalog.info[filename]).find(row=>Number(row[0])===id);
const name=(filename,id)=>localizedName(lookup(filename,id),id);
function defaults(key){if(key.endsWith('_editor'))return {enabled:false,records:[]};return {enabled:false,...({battle_preview:{mode:'hidden'},type_matchups:{cavalryVsInfantry:2,archerVsFlying:2,flyingVsCavalry:2},character_randomizer:{seed:12345,mixPromotionTiers:false},six_member_units:{honorCost:200},experience_scale:{multiplier:1}}[key]||{})};}
function state(key=moduleKey){return project.modules[key]??=defaults(key);}
function updateCount(){const count=Object.values(project.modules).filter(value=>value.enabled).length;$('selection-count').textContent=t(`${count} 个模块已启用${missionFrame?' · 含任务编辑工作区':''}`);$('export').disabled=count===0&&!missionFrame;}
function field(parent,label,value,callback,options){const wrapper=element('label',label,parent);wrapper.className='field';const input=element(options?'select':'input',undefined,wrapper);input.setAttribute('aria-label',t(label));if(options)for(const [value,text] of options){const option=element('option',text,input);option.value=value;}else{input.type='number';input.step='any';}input.value=value;input.onchange=()=>{if(!options&&(input.value===''||!Number.isFinite(Number(input.value)))){notify('请输入有效数字',true);return;}callback(options&&typeof value==='string'?input.value:Number(input.value));notify('修改已保留在当前工程；请启用模块后导出。');};return input;}
function checkbox(parent,label,value,callback){const wrapper=element('label',undefined,parent);wrapper.className='toggle';const input=element('input',undefined,wrapper);input.type='checkbox';input.checked=value;wrapper.append(document.createTextNode(t(label)));input.onchange=()=>callback(input.checked);}
function render(){renderContent();translateDom(document.body);}
function renderContent(){
  $('categories').replaceChildren();for(const label of [...new Set(definitions.map(row=>row[0]))]){const node=button($('categories'),label,()=>{category=label;moduleKey=definitions.find(row=>row[0]===category)[1];render();});node.className=category===label?'active':'';element('span','›',node);}
  $('module-tabs').replaceChildren();for(const row of definitions.filter(row=>row[0]===category)){const node=button($('module-tabs'),row[2],()=>{moduleKey=row[1];render();});node.className=moduleKey===row[1]?'active':'';}
  $('module-panel').replaceChildren();$('mission-host').hidden=!missionKeys.has(moduleKey);
  if(missionKeys.has(moduleKey)){
    ensureFrame();if(frameReady)missionFrame.contentWindow.postMessage({type:'uo-view',view:moduleKey,target:project.target},location.origin);
    updateCount();return;
  }
  const selected=state(),definition=definitions.find(row=>row[1]===moduleKey),card=element('section',undefined,$('module-panel'));card.className='card';const head=element('div',undefined,card);head.className='card-head';const title=element('div',undefined,head);element('h3',definition[2],title);element('p',definition[3],title);checkbox(head,'启用此模块',selected.enabled,value=>{selected.enabled=value;updateCount();});
  if(['experience_scale','enemy_level_scale'].includes(moduleKey)){
    const warning=element('div',project.target==='asia'?'亚洲版：2 倍经验与动态等级已完成样本实测；其他倍率和例外关卡未逐项实测。动态等级不重建旧战斗存档中的敌军。':'欧美版运行时补丁未经过本地游戏运行验证。',card);warning.className='warning';
    if(project.target==='asia'){
      const controls=element('div',undefined,card);controls.className='actions';
      button(controls,asiaSource?'更换原始 main':'选择原始 main',()=>{const input=document.createElement('input');input.type='file';input.onchange=async()=>{try{const file=input.files[0];if(!file)return;if(file.size>128*1024*1024)throw Error('游戏程序超过 128 MiB');const candidate=await validateAsiaSource(await file.arrayBuffer(),catalog.asiaRuntime);asiaSource=candidate;render();notify('原始 main 校验通过，仅保留在当前浏览器内存');}catch(error){notify(error.message,true);}};input.click();});
      element('span',asiaSource?'原始 main 已校验':'未选择原始 main（未压缩 NSO）',controls);
      if(asiaSource)button(controls,'清除原始 main',()=>{asiaSource=undefined;render();});
    }
  }
  if(moduleKey.endsWith('_editor'))renderRecords(card,selected);
  else{
    const grid=element('div',undefined,card);grid.className='grid';
    if(moduleKey==='battle_preview')field(grid,'预览模式',selected.mode,value=>selected.mode=value,[['hidden','隐藏预测结果'],['imperfect','不完全预测']]);
    if(moduleKey==='character_randomizer'){field(grid,'随机种子',selected.seed,value=>selected.seed=value);checkbox(grid,'允许跨转职阶段混合',selected.mixPromotionTiers,value=>selected.mixPromotionTiers=value);button(grid,'重新随机',()=>{selected.seed=crypto.getRandomValues(new Uint32Array(1))[0]%2147483647;render();});}
    if(moduleKey==='six_member_units')field(grid,'扩编荣誉费用',selected.honorCost,value=>selected.honorCost=value);
    if(moduleKey==='experience_scale')field(grid,'经验倍率',selected.multiplier,value=>selected.multiplier=value,[0.1,0.25,0.5,0.75,1,1.25,1.5,2,10].map(value=>[value,`${value} 倍`]));
    if(moduleKey==='type_matchups')for(const [key,label] of [['cavalryVsInfantry','骑兵 → 步兵'],['archerVsFlying','弓兵 → 飞行'],['flyingVsCavalry','飞龙 / 狮鹫 → 骑兵']])field(grid,label,selected[key],value=>selected[key]=value,[0.5,0.75,1,1.25,1.5,2,2.5,3,4,5,6,8,10].map(value=>[value,value+' 倍']));
  }
  const details=element('details',undefined,card);element('summary',isAsiaRuntime(moduleKey,project.target)?'查看写入预览（非独立 pchtxt）':'查看此模块补丁',details);const preview=element('pre','展开后生成预览',details);details.ontoggle=()=>{if(details.open)try{preview.textContent=generateMod(moduleKey,selected,project.target,catalog);}catch(error){preview.textContent=error.message;}};updateCount();
}
function renderRecords(card,selected){
  const key=moduleKey,filename={ability_editor:'skill.txt',class_editor:'classmod.txt',fort_editor:'fortmod.txt',mine_editor:'minemod.txt',shop_editor:'shopmod.txt'}[key],all=rows(catalog.info[filename]);
  const locations=key==='fort_editor'?catalog.fortLocations.filter(location=>location.start!==0&&!location.english.includes('Quarry')):key==='mine_editor'?catalog.fortLocations.filter(location=>location.english.includes('Quarry')):[];
  const location=row=>key==='shop_editor'?row[7]:locations.find(entry=>Number(row[0])>=entry.start&&Number(row[0])<entry.start+entry.count)?.name||'';
  const title=row=>`${row[0]} · ${key==='ability_editor'?localizedName(row):key==='class_editor'?name('class.txt',Number(row[0])):location(row)+' · '+name(key==='fort_editor'?'class.txt':'item.txt',Number(row[key==='shop_editor'?2:1]))}${key==='shop_editor'&&row[9]==='1'?'（共享）':''}`;
  const pickerArea=element('div',undefined,card);pickerArea.className='record-picker grid';const search=element('input',undefined,pickerArea);search.placeholder='搜索名称 / ID';search.setAttribute('aria-label','搜索记录');const filter=element('select',undefined,pickerArea);filter.setAttribute('aria-label','筛选地区或类型');const option=element('option','全部',filter);option.value='';for(const label of key==='ability_editor'?['主动 A','被动 P']:[...new Set(all.map(location).filter(Boolean))]){const option=element('option',label,filter);option.value=label;}
  const picker=element('select',undefined,pickerArea);picker.setAttribute('aria-label','选择编辑记录');const summary=element('div',undefined,pickerArea);summary.className='muted';const body=element('div',undefined,card);
  function choose(){body.replaceChildren();const row=all.find(row=>row[0]===picker.value);if(!row)return;recordSelections.set(key,picker.value);const id=Number(row[0]);let record=selected.records.find(record=>record.id===id);let baseline;
    if(key==='ability_editor')baseline={id,cost:Number(row[5]),physicalPotency:Number(row[6]),magicalPotency:Number(row[7]),accuracy:Number(row[8]),targetShape:Number(row[9]),effectValue:Number(row[10])};
    if(key==='class_editor')baseline={id,ap:Number(row[1]),pp:Number(row[2]),growths:row.slice(3,13).map(Number),activeSkills:Array.from({length:4},(_,index)=>({skillId:Number(row[13+index*2]),level:Number(row[14+index*2])})),passiveSkills:Array.from({length:4},(_,index)=>({skillId:Number(row[21+index*2]),level:Number(row[22+index*2])}))};
    if(key==='fort_editor')baseline={id,classId:Number(row[1])};if(key==='mine_editor')baseline={id,itemId:Number(row[1]),weight:Number(row[2]),digTarget:Number(row[3]),roundLimit:Number(row[5])};if(key==='shop_editor')baseline={id,itemId:Number(row[2]),stock:Number(row[3]),price:Number(row[4])};record??=structuredClone(baseline);
    const change=callback=>value=>{callback(value);selected.records=selected.records.filter(entry=>entry.id!==id);if(JSON.stringify(record)!==JSON.stringify(baseline))selected.records.push(record);summary.textContent=t(`已修改 ${selected.records.length} 条记录`);};summary.textContent=t(`已修改 ${selected.records.length} 条记录`);
    const heading=element('div',undefined,body);heading.className='record-summary';element('strong',title(row),heading);button(heading,'恢复此条原版',()=>{selected.records=selected.records.filter(entry=>entry.id!==id);choose();});const grid=element('div',undefined,body);grid.className='grid three';
    if(key==='ability_editor'){for(const [property,label] of [['cost','AP / PP 消耗'],['physicalPotency','物理威力'],['magicalPotency','魔法威力'],['accuracy','命中'],['effectValue','首个效果参数']])field(grid,label,record[property],change(value=>record[property]=value));field(grid,'目标范围',record.targetShape,change(value=>record.targetShape=value),[[0,'原始 / 无目标'],[1,'单体'],[2,'2个目标'],[3,'3个目标'],[5,'全体'],[6,'一排'],[7,'前后纵列']]);const desc=lookup('skilldesc-'+({'zh-CN':'cn','en-US':'en','ja-JP':'ja'}[getLanguage()])+'.txt',id);if(desc){const description=element('p',undefined,body);description.dataset.noTranslate='';description.textContent=new TextDecoder().decode(Uint8Array.from(atob(desc[1]),character=>character.charCodeAt(0)));}}
    if(key==='class_editor'){
      field(grid,'AP',record.ap,change(value=>record.ap=value));field(grid,'PP',record.pp,change(value=>record.pp=value));for(const [index,label] of ['生命','物攻','物防','魔攻','魔防','命中','闪避','暴击','格挡','速度'].entries())field(grid,label+'成长',record.growths[index],change(value=>record.growths[index]=value));
      for(const [property,label,type] of [['activeSkills','主动技能','A'],['passiveSkills','被动技能','P']]){element('h4',label,body);const slots=element('div',undefined,body);slots.className='grid';record[property].forEach((slot,index)=>{field(slots,`${label} ${index+1}`,slot.skillId,change(value=>slot.skillId=value),[[0,'0 · 空槽'],...rows(catalog.info['skill.txt']).filter(row=>row[4]===type).map(row=>[Number(row[0]),`${row[0]} · ${localizedName(row)}`])]);const input=field(slots,'习得等级',slot.level,change(value=>slot.level=value));input.disabled=index===0;});}element('p','技能全局默认条件在「默认战术」页中。修改同一职业的技能时，请不要同时导出两份相互覆盖的补丁。',body);
    }
    if(key==='fort_editor')field(grid,'招募职业',record.classId,change(value=>record.classId=value),rows(catalog.info['class.txt']).filter(row=>/^\d+$/.test(row[0])&&Number(row[0])<74).map(row=>[Number(row[0]),localizedName(row)]));
    if(key==='mine_editor'||key==='shop_editor'){field(grid,'物品',record.itemId,change(value=>record.itemId=value),rows(catalog.info['item.txt']).filter(row=>Number(row[0])<=970).map(row=>[Number(row[0]),`${row[0]} · ${localizedName(row)}`]));for(const [property,label] of key==='mine_editor'?[['weight','相对权重'],['digTarget','挖掘目标'],['roundLimit','单局上限']]:[['stock','库存（-1为无限）'],['price','全局买价（卖价为1/10）']])field(grid,label,record[property],change(value=>record[property]=value));}
  }
  const populate=()=>{const previous=picker.value||recordSelections.get(key);picker.replaceChildren();for(const row of all){if(!(title(row)+' '+t(title(row))).toLowerCase().includes(search.value.toLowerCase()))continue;if(filter.value&&(key==='ability_editor'?row[4]!==filter.value.slice(-1):location(row)!==filter.value))continue;const option=element('option',title(row),picker);option.value=row[0];}if([...picker.options].some(option=>option.value===previous))picker.value=previous;choose();};search.oninput=populate;filter.onchange=populate;picker.onchange=choose;populate();
}
$('target').onchange=()=>{project.target=$('target').value;missionFrame?.contentWindow.postMessage({type:'uo-target',target:project.target},location.origin);render();};
$('language').onchange=()=>{setLanguage($('language').value);document.documentElement.lang=getLanguage();try{localStorage.setItem('uo-language',getLanguage());}catch{}saveController?.refresh();missionFrame?.contentWindow.postMessage({type:'uo-language',language:getLanguage()},location.origin);render();};
$('show-save').onclick=()=>{$('save-workspace').hidden=false;$('mod-workspace').hidden=true;$('show-save').className='active';$('show-mod').className='';$('mod-toolbar').querySelector('.actions').hidden=true;$('mod-toolbar').querySelector('strong').textContent=t('存档编辑');};
$('show-mod').onclick=()=>{$('save-workspace').hidden=true;$('mod-workspace').hidden=false;$('show-save').className='';$('show-mod').className='active';$('mod-toolbar').querySelector('.actions').hidden=false;$('mod-toolbar').querySelector('strong').textContent=t('MOD 工程');};
$('save-project').onclick=async()=>{try{if(missionFrame)project.missionEdits=(await requestFrame('uo-request-edits')).edits;download('unicorn-mod-project.json',JSON.stringify(project,null,2));notify('完整工程已保存，包含任务、预设、职业默认战术与装备');}catch(error){notify(error.message,true);}};
$('import-project').onclick=()=>{const input=document.createElement('input');input.type='file';input.accept='.json';input.onchange=async()=>{try{
  const file=input.files[0];if(!file)return;if(file.size>16*1024*1024)throw Error('工程超过16 MiB');const candidate=JSON.parse(await file.text());
  if(candidate.schema!==1||!TARGETS[candidate.target]||!candidate.modules||Array.isArray(candidate.modules))throw Error('不是本网站的MOD工程；上游工程请在任务编辑器中载入');
  for(const [key,value] of Object.entries(candidate.modules)){if(!definitions.some(row=>row[1]===key)||missionKeys.has(key)||!value||typeof value.enabled!=='boolean')throw Error('工程模块无效');if(value.enabled||value.records?.length)generateMod(key,value,candidate.target,catalog);}
  if(!confirm(t('载入工程会替换当前所有MOD修改，继续？')))return;
  if(candidate.missionEdits||missionFrame)await requestFrame('uo-load-edits',{edits:candidate.missionEdits||{},target:candidate.target});
  project=candidate;$('target').value=project.target;render();notify('完整工程已载入');
}catch(error){notify(error.message,true);}};input.click();};
$('reset').onclick=async()=>{try{if(!confirm(t('清空全部MOD工程修改，包括任务、职业默认装备与预设？')))return;if(missionFrame)await requestFrame('uo-load-edits',{edits:{}});project={schema:1,target:project.target,modules:{}};render();notify('全部MOD修改已重置');}catch(error){notify(error.message,true);}};
$('export').onclick=async()=>{try{
  const snapshot=structuredClone(project);
  const source=asiaSource;
  const patches=Object.entries(snapshot.modules).filter(([,value])=>value.enabled).map(([key,value])=>({key,content:generateMod(key,value,snapshot.target,catalog)}));
  if(missionFrame){const result=await requestFrame('uo-request-patch',{target:snapshot.target});snapshot.missionEdits=result.edits;if(result.content)patches.push({key:'mission_editor',content:result.content});}
  if(!patches.length)throw Error('没有可导出的修改；请启用普通模块或编辑任务/默认装备');validateConflicts(patches);
  const target=TARGETS[snapshot.target],runtime=patches.some(patch=>isAsiaRuntime(patch.key,snapshot.target));
  if(runtime&&!source)throw Error('请在经验倍率或动态等级模块选择原始 main');
  const files=runtime?[{name:'unicorn_asia_merged/exefs/main',content:await buildAsiaMain(source,patches,catalog.asiaRuntime)}]:patches.map(patch=>({name:`${patch.key}/exefs/${target.buildId}.pchtxt`,content:patch.content}));
  if(runtime)files.push({name:'亚洲版运行时说明.txt',content:t('亚洲版导出为单一 main，包含本工程全部启用修改。请禁用旧版重叠 MOD，停止游戏后安装并重新启动。原始 main 不写入工程 JSON；重新打开网页后需重新选择。生成的 main 含游戏程序，请勿公开分发。')});
  files.push({name:'unicorn-mod-project.json',content:JSON.stringify(snapshot,null,2)},{name:'使用说明.txt',content:`独角兽之王 MOD · ${snapshot.target} v1.0.5\nTitle ID: ${target.titleId}\n将模块文件夹放入模拟器对应游戏的MOD目录。仅支持匹配Build ID。请备份存档；静态测试不代表游戏内验证。\n工程包含任务/战术/默认装备的全部编辑；导出已统一检查模块间字节冲突。`},{name:'THIRD_PARTY_MODS.txt',content:await (await fetch('./THIRD_PARTY_MODS.txt')).text()});
  download('UnicornOverlord_MOD_'+snapshot.target+'.zip',zipFiles(files));notify(`已导出 ${patches.length} 个模块，字节冲突检查通过`);
}catch(error){notify(error.message,true);}};
window.addEventListener('beforeunload',event=>{if(missionFrame||Object.keys(project.modules).some(key=>project.modules[key].enabled||project.modules[key].records?.length)||saveController?.hasChanges()){event.preventDefault();event.returnValue='';}});
try{const response=await fetch('./data/catalog.json');if(!response.ok)throw Error('目录加载失败');catalog=await response.json();configureTranslations(catalog);try{const saved=localStorage.getItem('uo-language');if(saved)setLanguage(saved);}catch{}$('language').value=getLanguage();document.documentElement.lang=getLanguage();saveController=mountSave($('save-workspace'),catalog,notify);render();notify('就绪 · 文件只在浏览器本地处理');}catch(error){notify(error.message,true);}
