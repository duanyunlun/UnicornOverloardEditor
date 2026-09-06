import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {generateMod,TARGETS,parsePatch} from './mod-engine.js';
import {buildAsiaMain,validateAsiaSource} from './asia-runtime.js';
const data=JSON.parse(await readFile(new URL('./asia-runtime-data.json',import.meta.url),'utf8'));
const catalog={asiaRuntime:data};
const patch=(key,state={})=>({key,content:generateMod(key,state,'asia',catalog)});
test('亚洲运行时所有倍率与等级指令、损坏输入拒绝',async()=>{
  for(const multiplier of [0.1,0.25,0.5,0.75,1,1.25,1.5,2,10])assert.ok(parsePatch(patch('experience_scale',{multiplier}).content,'asia').size);
  assert.ok(parsePatch(patch('enemy_level_scale').content,'asia').size);
  assert.throws(()=>patch('experience_scale',{multiplier:3}));
  await assert.rejects(()=>validateAsiaSource(new Uint8Array(256),data),/SHA-256/);
});
test('浏览器输出逐字节等价于已实测生成器，合包与边界保护',async context=>{
  let source;try{source=await readFile(new URL('../.extracted/exefs-asia-v1.0.5/main.dec',import.meta.url));}catch(error){if(error.code!=='ENOENT')throw error;context.skip('本机合法提取的游戏文件未提供');return;}
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  const levels=patch('enemy_level_scale');
  assert.equal(hash(await buildAsiaMain(source,[levels],data)),data.hashes['none:1']);
  for(const multiplier of [0.1,0.25,0.5,0.75,1,1.25,1.5,2,10])for(const enabled of [false,true]){
    const patches=[patch('experience_scale',{multiplier}),...(enabled?[levels]:[])];
    assert.equal(hash(await buildAsiaMain(source,patches,data)),data.hashes[`${multiplier}:${Number(enabled)}`]);
  }
  const extra=address=>({key:'extra',content:`@nsobid-${TARGETS.asia.buildId}\n@enabled\n${address} FF\n@stop`});
  await assert.rejects(()=>buildAsiaMain(source,[levels,extra('0084DBD0')],data),/冲突/);
  await assert.rejects(()=>buildAsiaMain(source,[levels,extra('00000010')],data),/地址/);
  await assert.rejects(()=>buildAsiaMain(source,[levels,extra('FFFFFFFF')],data),/地址/);
  const merged=await buildAsiaMain(source,[levels,extra('00D36F40')],data);
  assert.equal(merged[0xd36f40],255);assert.deepEqual(source,await readFile(new URL('../.extracted/exefs-asia-v1.0.5/main.dec',import.meta.url)));
  const view=new DataView(merged.buffer);
  for(const [header,digest] of [[0x10,0xa0],[0x20,0xc0],[0x30,0xe0]])assert.equal(hash(merged.subarray(view.getUint32(header,true),view.getUint32(header,true)+view.getUint32(header+8,true))),Buffer.from(merged.subarray(digest,digest+32)).toString('hex'));
});
