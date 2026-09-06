import {TARGETS} from './mod-engine.js';

export function migrateDesktopProject(input){
  if(input?.schemaVersion!==1)return input;
  const target=input.target?.Key;
  if(!Object.hasOwn(TARGETS,target)||input.target.TitleId!==TARGETS[target].titleId||input.target.BuildId!==TARGETS[target].buildId||!Array.isArray(input.modules))throw Error('桌面工程格式或目标版本无效');
  const project={schema:1,target,modules:{},missionEdits:{}};
  const fields={RecordId:'id',Cost:'cost',Accuracy:'accuracy',TargetShape:'targetShape',PhysicalPotency:'physicalPotency',MagicalPotency:'magicalPotency',EffectValue:'effectValue',Ap:'ap',Pp:'pp',Growths:'growths',ClassId:'classId',ItemId:'itemId',Weight:'weight',DigTarget:'digTarget',RoundLimit:'roundLimit',Stock:'stock',Price:'price'};
  const seen=new Set();let classes;
  for(const module of input.modules){
    if(!module||typeof module.Key!=='string'||seen.has(module.Key))throw Error('桌面工程模块无效或重复');seen.add(module.Key);
    const key=module.Key,state={enabled:true};
    if(key==='mission_editor'){
      if(!module.edits||Array.isArray(module.edits)||typeof module.edits!=='object')throw Error('桌面任务工程无效');
      project.missionEdits=structuredClone(module.edits);continue;
    }
    if(['ability_editor','class_editor','fort_editor','mine_editor','shop_editor'].includes(key)){
      if(!Array.isArray(module.records))throw Error('桌面工程记录无效');
      state.records=module.records.map(record=>{
        const converted={};for(const [source,destination] of Object.entries(fields))if(Object.hasOwn(record,source))converted[destination]=structuredClone(record[source]);
        if(key==='class_editor')for(const [source,destination] of [['ActiveSkills','activeSkills'],['PassiveSkills','passiveSkills']])converted[destination]=record[source].map(slot=>({skillId:slot.SkillId,level:slot.Level}));
        return converted;
      });
      if(!state.records.length)state.enabled=false;
      if(key==='class_editor')classes=module;
    }else if(key==='battle_preview'){
      if(![0,1].includes(module.mode))throw Error('未知预览模式');state.mode=module.mode===1?'imperfect':'hidden';
    }else if(key==='character_randomizer')Object.assign(state,{seed:module.Seed,mixPromotionTiers:module.MixPromotionTiers});
    else if(key==='type_matchups')Object.assign(state,{cavalryVsInfantry:module.CavalryVsInfantry,archerVsFlying:module.ArcherVsFlying,flyingVsCavalry:module.FlyingVsCavalry});
    else if(key==='six_member_units')state.honorCost=module.HonorCost;
    else if(key==='experience_scale')state.multiplier=module.multiplier;
    else if(!['battle_timer_freeze','unlimited_battle_start','enemy_level_scale'].includes(key))throw Error('桌面工程含尚未支持的模块');
    project.modules[key]=state;
  }
  delete project.missionEdits.class_tactics;delete project.missionEdits.equiptype_items;
  if(classes){
    if(classes.class_tactics)project.missionEdits.class_tactics=structuredClone(classes.class_tactics);
    if(classes.equiptype_items)project.missionEdits.equiptype_items=structuredClone(classes.equiptype_items);
  }
  return project;
}
