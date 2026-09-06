import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {TARGETS,rows,generateMod,parsePatch,validateConflicts,zipFiles} from './mod-engine.js';
const catalog={info:{},templates:{}};
catalog.asiaRuntime=JSON.parse(await readFile(new URL('./asia-runtime-data.json',import.meta.url),'utf8'));
for(const [folder,key,extension] of [['info','info','.txt'],['mods','templates','.pchtxt']])for(const filename of await readdir(new URL('../UnicornOverlord/'+folder+'/',import.meta.url)))if(filename.endsWith(extension))catalog[key][filename]=await readFile(new URL('../UnicornOverlord/'+folder+'/'+filename,import.meta.url),'utf8');
test('所有非任务MOD两版输出、无效输入与冲突保护',()=>{
  const skill=rows(catalog.info['skill.txt'])[0],classRow=rows(catalog.info['classmod.txt'])[0];
  const states={ability_editor:{records:[{id:Number(skill[0]),cost:2,physicalPotency:125,magicalPotency:0,accuracy:100,targetShape:1,effectValue:0.25}]},class_editor:{records:[{id:1,ap:2,pp:2,growths:classRow.slice(3,13).map(Number),activeSkills:Array.from({length:4},(_,index)=>({skillId:Number(classRow[13+index*2]),level:Number(classRow[14+index*2])})),passiveSkills:Array.from({length:4},(_,index)=>({skillId:Number(classRow[21+index*2]),level:Number(classRow[22+index*2])}))}]},fort_editor:{records:[{id:1,classId:7}]},mine_editor:{records:[{id:0,itemId:95,weight:55,digTarget:40,roundLimit:999}]},shop_editor:{records:[{id:0,itemId:645,stock:1,price:2222}]},type_matchups:{cavalryVsInfantry:1.5,archerVsFlying:2,flyingVsCavalry:3},battle_preview:{mode:'hidden'},battle_timer_freeze:{},unlimited_battle_start:{},six_member_units:{honorCost:100},character_randomizer:{seed:12345,mixPromotionTiers:false}};
  for(const target of Object.keys(TARGETS))for(const [key,state] of Object.entries(states)){const patch=generateMod(key,state,target,catalog);assert.ok(parsePatch(patch,target).size>0);assert.equal(patch,generateMod(key,state,target,catalog));}
  for(const multiplier of [0.1,0.25,0.5,0.75,1,1.25,1.5,2,10])assert.ok(parsePatch(generateMod('experience_scale',{multiplier},'western',catalog)).size);
  assert.ok(parsePatch(generateMod('enemy_level_scale',{},'western',catalog)).size);
  assert.ok(parsePatch(generateMod('enemy_level_scale',{},'asia',catalog),'asia').size);assert.throws(()=>generateMod('ability_editor',{records:[]},'asia',catalog));
  const patch=generateMod('fort_editor',states.fort_editor,'asia',catalog);assert.throws(()=>parsePatch(patch,'western'));assert.throws(()=>validateConflicts([{key:'first',content:patch},{key:'second',content:generateMod('fort_editor',{records:[{id:1,classId:8}]},'asia',catalog)}]));assert.ok(validateConflicts([{key:'first',content:patch},{key:'same',content:patch}])>0);
  const archive=zipFiles([{name:'中文.txt',content:'验证'}]);assert.equal(new DataView(archive.buffer).getUint32(0,true),0x04034b50);
});
