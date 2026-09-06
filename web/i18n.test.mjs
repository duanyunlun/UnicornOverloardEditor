import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {configureTranslations,setLanguage,t,LANGUAGES,localizedName} from './i18n.js';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const names=JSON.parse(read('./game-names.json'));
const doc=JSON.parse(gunzipSync(readFileSync(new URL('./info/mission_catalog.json.gz',import.meta.url))));
const info=Object.fromEntries(['class','skill','item','name'].map(name=>[name+'.txt',read('./info/'+name+'.txt')]));
const nameTranslations=[];
for(const [entries,file,id,symbol] of [[doc.class_tactics,'class.txt','class_id','class_symbol'],[doc.skills,'skill.txt','id','symbol'],[doc.items,'item.txt','id','symbol']]){
  const rows=new Map(info[file].split(/\r?\n/).filter(line=>/^\d+\t/.test(line)).map(line=>{const row=line.split('\t');return [Number(row[0]),[row[3],row[1],row[2]]];}));
  for(const entry of entries)if(rows.has(entry[id]))nameTranslations.push({values:rows.get(entry[id]),aliases:[entry[symbol]]});
}
for(const entry of doc.missions)nameTranslations.push({values:names.missions[entry.quest_id],aliases:[entry.quest_symbol]});
for(const entry of doc.equipai_if)nameTranslations.push({values:names.conditions[entry.id],aliases:[entry.symbol]});
const catalog={info,nameTranslations,uiTranslations:JSON.parse(read('./ui-translations.json')),locales:Object.fromEntries(LANGUAGES.map(language=>[language,JSON.parse(read('./locales/'+language+'.json'))]))};
test('仓库中英日名称、关卡和条件按语言显示，数据标识不变',()=>{
  const original=JSON.stringify(catalog);
  assert.equal(Object.keys(names.missions).length,90);
  assert.equal(Object.keys(names.conditions).length,203);
  for(const [column,language] of LANGUAGES.entries()){
    setLanguage(language);configureTranslations(catalog);
    for(const entry of nameTranslations){assert.ok(entry.values[column],entry.aliases[0]+' 缺少 '+language);assert.equal(t(entry.aliases[0]),entry.values[column],entry.aliases[0]+' '+language);}
  }
  setLanguage('zh-CN');assert.equal(t('DARK_PRINCE_HG'),'桀纣霸主');assert.equal(t('MY_HP_50PER_LOWER'),'自身HP不高于50％');
  setLanguage('en-US');assert.equal(t('MY_HP_75PER_LOWER'),'Own HP ≤75%');assert.equal(t('全部'),'All');
  setLanguage('ja-JP');assert.equal(t('DARK_PRINCE_HG'),'オーバーロード');
  assert.equal(JSON.stringify(catalog),original);
  assert.throws(()=>setLanguage('unknown'));
});
test('同名中文物品按记录取译文，不通过名称反查覆盖',()=>{
  configureTranslations(catalog);
  const items=new Map(info['item.txt'].split(/\r?\n/).filter(line=>/^\d+\t/.test(line)).map(line=>{const row=line.split('\t');return [Number(row[0]),row];}));
  assert.equal(items.get(65)[3],items.get(115)[3]);
  for(const [column,language] of [[1,'en-US'],[2,'ja-JP'],[3,'zh-CN']]){
    setLanguage(language);
    for(const id of [65,115])assert.equal(localizedName(items.get(id)),items.get(id)[column]);
  }
  assert.equal(localizedName(undefined,9999),'ID 9999');
});
