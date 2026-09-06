import {parsePatch,validateConflicts} from './mod-engine.js';

export const isAsiaRuntime=(key,target)=>target==='asia'&&['experience_scale','enemy_level_scale'].includes(key);
const digest=async data=>new Uint8Array(await crypto.subtle.digest('SHA-256',data));
const hex=data=>Array.from(data,value=>value.toString(16).padStart(2,'0')).join('');
export async function validateAsiaSource(buffer,data){
  const source=new Uint8Array(buffer);
  if(hex(await digest(source))!==data.sourceSha)throw Error('请选择亚洲版 v1.0.5 未修改、未压缩的 main（SHA-256 不匹配）');
  return source;
}
export async function buildAsiaMain(buffer,patches,data){
  const source=await validateAsiaSource(buffer,data),output=source.slice(),view=new DataView(output.buffer);
  validateConflicts(patches);
  const runtime=patches.filter(patch=>isAsiaRuntime(patch.key,'asia'));
  if(!runtime.length)throw Error('没有亚洲版运行时补丁');
  let textEnd=0x84dad0;
  for(const patch of runtime)for(const address of parsePatch(patch.content,'asia').keys())textEnd=Math.max(textEnd,address-0x100+1);
  if(textEnd<=0x84dad0||textEnd>0x84e000)throw Error('运行时补丁超出可执行段');
  for(const patch of patches)for(const [address,value] of parsePatch(patch.content,'asia')){
    if(address<0x100||address>=output.length)throw Error('补丁地址超出游戏程序');
    output[address]=value;
  }
  view.setUint32(0x18,textEnd,true);view.setUint32(0x60,textEnd,true);
  for(const [header,hash] of [[0x10,0xa0],[0x20,0xc0],[0x30,0xe0]]){
    const start=view.getUint32(header,true),size=view.getUint32(header+8,true);
    if(start<0x100||start+size>output.length)throw Error('NSO 段范围无效');
    output.set(await digest(output.subarray(start,start+size)),hash);
  }
  return output;
}
