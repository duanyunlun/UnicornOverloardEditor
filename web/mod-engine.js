export const TARGETS={asia:{titleId:'010054B01AD92000',buildId:'9C3116F0333EA157526612D17354B3755737C4F2'},western:{titleId:'010069401ADB8000',buildId:'C841FFE2717FF03A13990480C51DA73F091C04FA'}};
export const rows=text=>(text||'').replace(/^\uFEFF/,'').split(/\r?\n/).filter(line=>line.trim()&&!line.startsWith('#')).map(line=>line.split('\t'));
const hex=bytes=>Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('').toUpperCase();
const integer=(value,min,max,label)=>{if(!Number.isInteger(value)||value<min||value>max) throw Error(`${label} 必须为 ${min}–${max} 的整数`);return value;};
function bytes(value,size=4,float=false){const result=new Uint8Array(size);const view=new DataView(result.buffer);if(float){if(!Number.isFinite(value)||Math.abs(value)>3.4e38)throw Error('浮点数无效');view.setFloat32(0,value,true);}else {integer(value,size===4?-2147483648:0,2**(size*8)-1,'数值');if(size===4)view.setUint32(0,value,true);else if(size===2)view.setUint16(0,value,true);else result[0]=value;}return result;}
export function parsePatch(text,target){
  const result=new Map();let enabled=false,shift=0,build='';
  for(const raw of text.split(/\r?\n/)){
    const line=raw.split('//')[0].trim();if(!line||line.startsWith('#'))continue;
    if(line.startsWith('@nsobid-')){build=line.slice(8).toUpperCase();continue;}
    if(line==='@enabled'){enabled=true;continue;}if(line==='@disabled'){enabled=false;continue;}if(line==='@stop')break;
    const flag=line.match(/^@flag offset_shift (0x[\da-f]+|\d+)$/i);if(flag){shift=Number(flag[1]);continue;}
    if(line.startsWith('@'))throw Error(`不支持的补丁指令：${line}`);
    const match=line.match(/^([\da-f]{8})\s+((?:[\da-f]{2})+)$/i);if(!match)throw Error('补丁格式无效');if(!enabled)continue;
    const address=parseInt(match[1],16)+shift;
    for(let offset=0;offset<match[2].length/2;offset++){const value=parseInt(match[2].slice(offset*2,offset*2+2),16);if(result.has(address+offset)&&result.get(address+offset)!==value)throw Error(`补丁内部冲突：${(address+offset).toString(16)}`);result.set(address+offset,value);}
  }
  if(!Object.values(TARGETS).some(entry=>entry.buildId===build)||target&&TARGETS[target]?.buildId!==build)throw Error('补丁 Build ID 与目标版本不匹配');
  if(!result.size)throw Error('补丁没有已启用的写入');return result;
}
export function validateConflicts(patches){const seen=new Map();for(const patch of patches)for(const [address,value] of parsePatch(patch.content)){const old=seen.get(address);if(old&&old.value!==value)throw Error(`${old.key} 与 ${patch.key} 在 0x${address.toString(16)} 冲突`);seen.set(address,{value,key:patch.key});}return seen.size;}
function seededRandom(seed){
  const maximum=2147483647,values=new Array(56).fill(0);let previous=161803398-Math.abs(seed===-2147483648?2147483647:seed),next=1;values[55]=previous;
  for(let index=1;index<55;index++){const slot=21*index%55;values[slot]=next;next=previous-next;if(next<0)next+=maximum;previous=values[slot];}
  for(let pass=0;pass<4;pass++)for(let index=1;index<56;index++){values[index]-=values[1+(index+30)%55];if(values[index]<0)values[index]+=maximum;}
  let first=0,second=21;return limit=>{if(++first>=56)first=1;if(++second>=56)second=1;let value=values[first]-values[second];if(value===maximum)value--;if(value<0)value+=maximum;values[first]=value;return Math.floor(value/maximum*limit);};
}
export function generateMod(key,state,target,catalog){
  if(!TARGETS[target])throw Error('未知目标版本');const writes=[];
  const write=(address,value,size=4,float=false)=>writes.push([address,bytes(value,size,float)]);
  const table=name=>new Map(rows(catalog.info[name]).map(row=>[Number(row[0]),row]));
  const records=state.records||[];
  if(key==='ability_editor')for(const record of records){const original=table('skill.txt').get(record.id);if(!original)throw Error('未知技能');const address=0x2787F28+record.id*0x130;write(address+(original[4]==='P'?12:10),integer(record.cost,0,10,'消耗'),2);write(address+0x18,record.physicalPotency,4,true);write(address+0x1c,record.magicalPotency,4,true);write(address+0x22,integer(record.accuracy,0,999,'命中'),2);write(address+0x28,integer(record.targetShape,0,255,'目标'),1);write(address+0x3c,record.effectValue,4,true);}
  else if(key==='class_editor'){
    for(const record of records){integer(record.id,1,73,'职业');const original=table('classmod.txt').get(record.id);if(!original)throw Error('未知职业');const address=0xD36E40+(record.id-1)*0x8c;if(record.growths.length!==10)throw Error('需要十项成长率');record.growths.forEach((value,index)=>{if(!Number.isFinite(value)||value<0||value>1000)throw Error('成长率必须为0–1000');if(value!==Number(original[3+index]))write(0xD2DFCC+record.id*0x58+index*4,value,4,true);});integer(record.ap,1,4,'AP');integer(record.pp,1,4,'PP');for(let index=0;index<4;index++){if(record.ap!==Number(original[1]))write(address+0x20+index*4,index<record.ap?1:0);if(record.pp!==Number(original[2]))write(address+0x50+index*4,index<record.pp?1:0);}
      for(const [slots,offset,column] of [[record.activeSkills,4,13],[record.passiveSkills,0x34,21]]){if(slots.length!==4)throw Error('需要四个技能槽');slots.forEach((slot,index)=>{if(slot.skillId!==0&&!table('skill.txt').has(slot.skillId))throw Error('未知技能');if(slot.skillId!==Number(original[column+index*2]))write(address+offset+index*8,slot.skillId);const level=slot.skillId?integer(slot.level,1,99,'习得等级'):0;if(index&&level!==Number(original[column+index*2+1]))write(address+offset+index*8-4,level);});}
    }
    for(const record of state.conditions||[]){if(!table('skill.txt').has(record.id))throw Error('未知技能');write(0x2787F28+record.id*0x130+0xac,integer(record.first,0,202,'条件'));write(0x2787F28+record.id*0x130+0xb0,integer(record.second,0,202,'条件'));}
  }
  else if(key==='fort_editor')for(const record of records)write(0xD4D67C+integer(record.id,1,248,'据点槽位')*16,integer(record.classId,0,73,'职业'));
  else if(key==='mine_editor')for(const record of records){const address=0xD523F8+integer(record.id,0,62,'采矿槽位')*24;write(address,integer(record.itemId,0,970,'物品'));write(address+4,integer(record.weight,0,1000000,'权重'));write(address+8,integer(record.digTarget,0,1000000,'挖掘目标'));write(address+16,integer(record.roundLimit,1,999999,'上限'));}
  else if(key==='shop_editor')for(const record of records){const original=table('shopmod.txt').get(record.id);if(!original)throw Error('未知商店记录');const address=Number(original[1]);if(record.address!==undefined&&record.address!==address)throw Error('不可更改商店地址');write(address+4,integer(record.itemId,0,970,'物品'));write(address+12,integer(record.stock,-1,9999,'库存'));const price=integer(record.price,0,65535,'价格');write(0x2716188+record.itemId*0xb8,price,2);write(0x271618c+record.itemId*0xb8,Math.floor(price/10),2);}
  else if(key==='type_matchups'){const instructions={0.5:0x1E2C1000,0.75:0x1E2D1000,1:0x1E2E1000,1.25:0x1E2E9000,1.5:0x1E2F1000,2:0x1E201000,2.5:0x1E209000,3:0x1E211000,4:0x1E221000,5:0x1E229000,6:0x1E231000,8:0x1E241000,10:0x1E249000};for(const [address,value] of [[0x451cc,state.cavalryVsInfantry],[0x451ec,state.archerVsFlying],[0x45208,state.flyingVsCavalry]]){if(!instructions[value])throw Error('不支持的克制倍率');write(address,instructions[value]);}}
  if(['ability_editor','class_editor','fort_editor','mine_editor','shop_editor','type_matchups'].includes(key)){
    if(!writes.length)throw Error('尚未修改任何记录');const content=`@nsobid-${TARGETS[target].buildId}\n@flag offset_shift 0x100\n@enabled\n${writes.sort((left,right)=>left[0]-right[0]).map(([address,data])=>address.toString(16).padStart(8,'0').toUpperCase()+' '+hex(data)).join('\n')}\n@stop\n`;parsePatch(content,target);return content;
  }
  const suffix=target==='western'?'_western':'';let filename;
  if(key==='experience_scale'||key==='enemy_level_scale'){
    if(key==='experience_scale'&&![0.1,0.25,0.5,0.75,1,1.25,1.5,2,10].includes(state.multiplier))throw Error('不支持的经验倍率');
    if(target==='asia'){
      const instructions=catalog.asiaRuntime?.variants[key==='enemy_level_scale'?'levels':String(state.multiplier)];
      if(!instructions)throw Error('缺少亚洲版运行时指令数据');
      const content=`@nsobid-${TARGETS.asia.buildId}\n@flag offset_shift 0x100\n@enabled\n${instructions.map(([address,value])=>address.toString(16).padStart(8,'0')+' '+hex(bytes(value))).join('\n')}\n@stop\n`;
      parsePatch(content,target);return content;
    }
    filename=key+'_western'+(key==='experience_scale'?'_'+state.multiplier:'')+'.pchtxt';
  }
  else if(key==='battle_preview'){if(!['hidden','imperfect'].includes(state.mode))throw Error('未知预览模式');filename=`battle_preview_${state.mode}${suffix}.pchtxt`;}
  else if(key==='character_randomizer')filename=`character_randomizer${suffix}_base.pchtxt`;
  else if(['battle_timer_freeze','unlimited_battle_start','six_member_units'].includes(key))filename=key+suffix+'.pchtxt';
  let content=catalog.templates[filename];if(!content)throw Error('缺少补丁模板');
  if(key==='six_member_units')content=content.replace(/^00B1ACAC\s+\S+/m,'00B1ACAC '+hex(bytes(integer(state.honorCost,0,999999,'荣誉费用'))));
  if(key==='character_randomizer'){
    const ids=[12,13,15,16,20,21,23,27,29,32,36,37,38,41,43,46,52,60,61,63,72,73,75,76,77,78,79,82,83,84,86,100,108,109,115,116,121,129,130,131,133,142,143,144,145,146,148,153,156,157,163,164,167,168,169,171,172,191,192,193,194,195,196];const base=[12,13,15,16,20,23,27,29,32,36,37,41,43,52,60,61,63,72,73,75,76,77,78,79,82,83,108,109,196];const random=seededRandom(integer(state.seed,-2147483648,2147483647,'种子')),sigma=Uint8Array.from({length:256},(_,index)=>index),inverse=sigma.slice();
    for(const group of state.mixPromotionTiers?[ids]:[base,ids.filter(id=>!base.includes(id))]){const shuffled=[...group];for(let index=shuffled.length-1;index>0;index--){const other=random(index+1);[shuffled[index],shuffled[other]]=[shuffled[other],shuffled[index]];}group.forEach((id,index)=>sigma[id]=shuffled[index]);}sigma.forEach((value,index)=>inverse[value]=index);content=content.replace('{{CHARACTER_SIGMA_TABLE}}',hex(sigma)).replace('{{CHARACTER_SIGMA_INVERSE_TABLE}}',hex(inverse));
  }
  parsePatch(content,target);return content;
}
export function zipFiles(files){
  const encoder=new TextEncoder(),parts=[],central=[];let offset=0;
  const crc32=data=>{let crc=0xffffffff;for(const byte of data){crc^=byte;for(let bit=0;bit<8;bit++)crc=crc>>>1^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;};
  for(const file of files){if(!file.name||file.name.split('/').includes('..'))throw Error('ZIP 文件名无效');const name=encoder.encode(file.name),data=typeof file.content==='string'?encoder.encode(file.content):file.content,crc=crc32(data),local=new Uint8Array(30+name.length),view=new DataView(local.buffer);view.setUint32(0,0x04034b50,true);view.setUint16(4,20,true);view.setUint16(6,0x800,true);view.setUint32(14,crc,true);view.setUint32(18,data.length,true);view.setUint32(22,data.length,true);view.setUint16(26,name.length,true);local.set(name,30);parts.push(local,data);const entry=new Uint8Array(46+name.length),directory=new DataView(entry.buffer);directory.setUint32(0,0x02014b50,true);directory.setUint16(4,20,true);directory.setUint16(6,20,true);directory.setUint16(8,0x800,true);directory.setUint32(16,crc,true);directory.setUint32(20,data.length,true);directory.setUint32(24,data.length,true);directory.setUint16(28,name.length,true);directory.setUint32(42,offset,true);entry.set(name,46);central.push(entry);offset+=local.length+data.length;}
  const length=central.reduce((sum,part)=>sum+part.length,0),end=new Uint8Array(22),view=new DataView(end.buffer);view.setUint32(0,0x06054b50,true);view.setUint16(8,files.length,true);view.setUint16(10,files.length,true);view.setUint32(12,length,true);view.setUint32(16,offset,true);const result=new Uint8Array(offset+length+22);let position=0;for(const part of [...parts,...central,end]){result.set(part,position);position+=part.length;}return result;
}
