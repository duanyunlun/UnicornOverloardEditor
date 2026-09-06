import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
const doc=JSON.parse(gunzipSync(readFileSync('web/info/mission_catalog.json.gz')));
function strings(path){const data=readFileSync(path);if(data.toString('ascii',0,4)!=='FMSB')throw Error('无效FMS');const count=data.readUInt32LE(20);return data.subarray(32+count*8).toString('utf8').split('\0').slice(0,count);}
const chinese=strings('.extracted/cpk-cn/MsgSheet/UcQuestList.fms');
const japanese=strings('.tools/i18n-source/MsgSheet/UcQuestList.fms');
const symbols=readFileSync('.tools/i18n-source/Debug/_UcEnum_QuestList.inc','utf8').split(/\r?\n/).slice(1).filter(line=>line.includes(',')).map(line=>line.split(',')[0].trim());
const conditions=strings('.extracted/cpk-cn/MsgSheet/UcFactorList.fms');
const result={source:'亚洲版v1.0.5中文FMS、日文FMS/枚举、固定上游英文目录',missions:{},conditions:{}};
for(const row of doc.missions){if(symbols[row.quest_id]!==row.quest_symbol)throw Error('关卡枚举不匹配：'+row.quest_id);result.missions[row.quest_id]=[chinese[row.quest_id-1],row.stage_name,japanese[row.quest_id-1]];}
for(const row of doc.equipai_if){const text=conditions[203+row.id];if(!text)throw Error('条件缺失：'+row.id);let english=row.name||'None';const threshold=row.symbol.match(/^MY_HP_(\d+)PER_(LOWER|HIGHER)$/);if(threshold)english=`Own HP ${threshold[2]==='LOWER'?'≤':'≥'}${threshold[1]}%`;result.conditions[row.id]=[text,english,row.comment||'なし'];}
if(result.conditions[106][0]!=='自身HP不高于50％')throw Error('战术条件索引校验失败');
writeFileSync('web/game-names.json',JSON.stringify(result,null,2)+'\n');
console.log(`导出 ${Object.keys(result.missions).length} 个关卡、${Object.keys(result.conditions).length} 个条件的多语言名称。`);
