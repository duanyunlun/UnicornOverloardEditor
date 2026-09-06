import {readFile,writeFile,mkdir,copyFile,readdir,cp,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {gunzipSync} from 'node:zlib';
const root=dirname(fileURLToPath(import.meta.url));
const destination=resolve(root,'dist');
await rm(destination,{recursive:true,force:true});
await mkdir(resolve(destination,'data'),{recursive:true});
for(const name of ['index.html','app.js','style.css','save.js','project.js','mod-engine.js','i18n.js','asia-runtime.js']) await copyFile(resolve(root,name),resolve(destination,name));
const catalog={info:{},templates:{},fortLocations:[]};
catalog.asiaRuntime=JSON.parse(await readFile(resolve(root,'asia-runtime-data.json'),'utf8'));
for(const [folder,extension,key] of [['info','.txt','info'],['mods','.pchtxt','templates']]) {
  for(const name of await readdir(resolve(root,folder))) if(name.endsWith(extension)) catalog[key][name]=await readFile(resolve(root,folder,name),'utf8');
}
catalog.fortLocations=JSON.parse(await readFile(resolve(root,'locations.json'),'utf8'));
catalog.locales={};for(const language of ['zh-CN','en-US','ja-JP'])catalog.locales[language]=JSON.parse(await readFile(resolve(root,'locales',language+'.json'),'utf8'));
catalog.uiTranslations=JSON.parse(await readFile(resolve(root,'ui-translations.json'),'utf8'));
const names=JSON.parse(await readFile(resolve(root,'game-names.json'),'utf8'));
const mission=JSON.parse(gunzipSync(await readFile(resolve(root,'info/mission_catalog.json.gz'))));
const table=filename=>new Map(catalog.info[filename].replace(/^\uFEFF/,'').split(/\r?\n/).filter(line=>/^\d+\t/.test(line)).map(line=>{const row=line.split('\t');return [Number(row[0]),[row[3],row[1],row[2]]];}));
catalog.nameTranslations=[];
const facilities=new Map(catalog.info['facility-ja.txt'].split(/\r?\n/).filter(line=>line&&!line.startsWith('#')).map(line=>line.split('\t')));
for(const location of catalog.fortLocations)catalog.nameTranslations.push({values:[location.name,location.english,facilities.get(location.name)],aliases:[]});
for(const line of catalog.info['shopmod.txt'].split(/\r?\n/).filter(line=>line&&!line.startsWith('#'))){const row=line.split('\t');catalog.nameTranslations.push({values:[row[7],row[5],row[6]],aliases:[]});}
for(const [entries,file,idKey,symbolKey] of [[mission.class_tactics,'class.txt','class_id','class_symbol'],[mission.skills,'skill.txt','id','symbol'],[mission.items,'item.txt','id','symbol']]){
  const entriesById=table(file);for(const entry of entries){const values=entriesById.get(entry[idKey]);if(values)catalog.nameTranslations.push({values,aliases:[entry[symbolKey],entry.name].filter(Boolean)});else if(file==='item.txt')catalog.nameTranslations.push({values:[`未命名物品 #${entry.id}`,`Unnamed Item #${entry.id}`,`名称なしアイテム #${entry.id}`],aliases:[entry.symbol]});}
}
for(const entry of mission.missions)catalog.nameTranslations.push({values:names.missions[entry.quest_id],aliases:[entry.stage_name,entry.quest_symbol]});
for(const entry of mission.equipai_if)catalog.nameTranslations.push({values:names.conditions[entry.id],aliases:[entry.symbol,entry.name,entry.comment].filter(Boolean)});
const nameTable=table('name.txt');for(const entry of mission.charasets){const values=nameTable.get(entry.id);if(values&&entry.id<=196&&entry.name)catalog.nameTranslations.push({values:[values[0],entry.name,values[2]],aliases:[entry.name]});}
const equipTypes={SWORD:['剑','Sword','剣'],LANCE:['枪','Lance','槍'],AXE:['斧','Axe','斧'],BOW:['弓','Bow','弓'],ROD:['杖','Staff','杖'],SHIELD:['盾','Shield','盾'],SHIELD_L:['大盾','Greatshield','大盾'],SWORD_M:['魔法剑','Magic Sword','魔法剣'],BOW_M:['魔法弓','Magic Bow','魔法弓'],ACC1:['饰品1','Accessory 1','アクセサリー1'],ACC2:['饰品2','Accessory 2','アクセサリー2']};
const tiers={DEFAULT:['默认','Default','既定'],ENEMY:['敌军','Enemy','敵軍'],NORMAL:['普通','Normal','通常'],POWER:['强化','Power','強化'],BOSS:['首领','Boss','ボス']};
for(const entry of mission.equiptype_items){const split=entry.symbol.indexOf('_'),tier=tiers[entry.symbol.slice(0,split)],kind=equipTypes[entry.symbol.slice(split+1)];if(tier&&kind)catalog.nameTranslations.push({values:tier.map((name,index)=>name+' · '+kind[index]),aliases:[entry.symbol]});}
await writeFile(resolve(destination,'data/catalog.json'),JSON.stringify(catalog));
await copyFile(resolve(root,'info/mission_catalog.json.gz'),resolve(destination,'data/mission_catalog.json.gz'));
await copyFile(resolve(root,'../docs/第三方MOD来源.md'),resolve(destination,'THIRD_PARTY_MODS.txt'));
await cp(resolve(root,'mission/dist'),resolve(destination,'mission'),{recursive:true});
await copyFile(resolve(root,'mission/LICENSE'),resolve(destination,'mission/LICENSE.txt'));
await writeFile(resolve(destination,'.nojekyll'),'');
console.log('静态网站已构建：web/dist（不包含存档、ROM 或本地工具）');
