import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {TARGETS,rows,generateMod,parsePatch,validateConflicts,zipFiles} from './mod-engine.js';
import {migrateDesktopProject} from './project.js';
const catalog={info:{},templates:{}};
catalog.asiaRuntime=JSON.parse(await readFile(new URL('./asia-runtime-data.json',import.meta.url),'utf8'));
for(const [folder,key,extension] of [['info','info','.txt'],['mods','templates','.pchtxt']])for(const filename of await readdir(new URL('./'+folder+'/',import.meta.url)))if(filename.endsWith(extension))catalog[key][filename]=await readFile(new URL('./'+folder+'/'+filename,import.meta.url),'utf8');
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
test('旧桌面工程转换全部非文本模块，保留职业/任务编辑并拒绝未知数据',()=>{
  const classRow=rows(catalog.info['classmod.txt'])[0];
  const modules=[
    {Key:'ability_editor',records:[{RecordId:28,Cost:1,Accuracy:100,TargetShape:1,PhysicalPotency:125,MagicalPotency:0,EffectValue:0.25}]},
    {Key:'class_editor',records:[{RecordId:1,Ap:4,Pp:4,Growths:classRow.slice(3,13).map(Number),ActiveSkills:Array.from({length:4},(_,index)=>({SkillId:Number(classRow[13+index*2]),Level:Math.max(1,Number(classRow[14+index*2]))})),PassiveSkills:Array.from({length:4},(_,index)=>({SkillId:Number(classRow[21+index*2]),Level:Math.max(1,Number(classRow[22+index*2]))}))}],class_tactics:[{class_id:1,lines:[]}],equiptype_items:[{equiptype_id:1,item_col0_id:282}]},
    {Key:'fort_editor',records:[{RecordId:1,ClassId:7}]},{Key:'mine_editor',records:[{RecordId:0,ItemId:95,Weight:55,DigTarget:40,RoundLimit:999}]},{Key:'shop_editor',records:[{RecordId:0,ItemId:645,Stock:1,Price:2222}]},
    {Key:'battle_preview',mode:1},{Key:'battle_timer_freeze'},{Key:'unlimited_battle_start'},
    {Key:'character_randomizer',Seed:12345,MixPromotionTiers:false},{Key:'type_matchups',CavalryVsInfantry:1.5,ArcherVsFlying:2,FlyingVsCavalry:3},
    {Key:'six_member_units',HonorCost:123},{Key:'experience_scale',multiplier:2},{Key:'enemy_level_scale'},
    {Key:'mission_editor',edits:{unitsets:[{unitset_id:101,slots:[]}],class_tactics:[{class_id:2,lines:[]}]}}
  ];
  for(const [key,target] of Object.entries(TARGETS)){
    const input={schemaVersion:1,target:{Key:key,TitleId:target.titleId,BuildId:target.buildId},modules};const before=JSON.stringify(input),project=migrateDesktopProject(input);
    assert.equal(Object.keys(project.modules).length,13);for(const [module,state] of Object.entries(project.modules))assert.ok(parsePatch(generateMod(module,state,key,catalog),key).size);
    assert.equal(project.modules.battle_preview.mode,'imperfect');assert.equal(project.modules.fort_editor.records[0].classId,7);
    assert.deepEqual(project.missionEdits.class_tactics,modules[1].class_tactics);assert.deepEqual(project.missionEdits.unitsets,modules.at(-1).edits.unitsets);assert.deepEqual(project.missionEdits.equiptype_items,modules[1].equiptype_items);
    assert.equal(JSON.stringify(input),before);assert.equal(migrateDesktopProject(project),project);
    assert.throws(()=>migrateDesktopProject({...input,target:{...input.target,BuildId:'invalid'}}));
    for(const extra of [{Key:'text_editor'},{Key:'battle_preview',mode:0},{Key:'__proto__'}])assert.throws(()=>migrateDesktopProject({...input,modules:[...modules,extra]}));
    assert.equal(migrateDesktopProject({...input,modules:[{Key:'battle_preview',mode:0}]}).modules.battle_preview.mode,'hidden');
  }
});
test('Web 地点表完整覆盖据点和采矿记录',async()=>{
  const locations=JSON.parse(await readFile(new URL('./locations.json',import.meta.url),'utf8'));
  for(const [filename,quarry,count] of [['fortmod.txt',false,63],['minemod.txt',true,5]]){
    const groups=locations.filter(location=>location.english.includes('Quarry')===quarry);assert.equal(groups.length,count);
    for(const record of rows(catalog.info[filename]))assert.equal(groups.filter(location=>Number(record[0])>=location.start&&Number(record[0])<location.start+location.count).length,1);
  }
});
