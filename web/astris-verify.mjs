import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SaveFile} from './save.js';

function characters(buffer) {
  const save=new SaveFile(buffer);
  const rows=save.characters().map(address=>[save.read(address),{nameId:save.read(address+52,2),level:save.read(address+60,2),xp:save.read(address+56)}]);
  const result=new Map(rows);
  assert.equal(result.size,rows.length,'存档存在重复角色 ID');
  return result;
}
function compare(before,baseline,patched,multiplier) {
  assert(Number.isFinite(multiplier)&&multiplier>0,'倍率必须为正数');
  const start=characters(before),normal=characters(baseline),modded=characters(patched),result=[];
  assert.equal(normal.size,start.size,'对照角色数量不同');
  assert.equal(modded.size,start.size,'补丁组角色数量不同');
  for(const [id,initial] of start) {
    const regular=normal.get(id),modified=modded.get(id);
    assert(regular&&modified,`缺少角色 ${id}`);
    assert.equal(regular.nameId,initial.nameId);assert.equal(modified.nameId,initial.nameId);
    const baseGain=regular.xp-initial.xp,modGain=modified.xp-initial.xp;
    assert(baseGain>=0&&modGain>=0,`角色 ${id} 经验减少，检查存档顺序`);
    if(!baseGain&&!modGain)continue;
    assert(baseGain>0,`补丁组角色 ${id} 产生了额外经验`);
    assert.equal(modGain,baseGain*multiplier,`角色 ${id} 倍率不符`);
    result.push({id,nameId:initial.nameId,baseGain,modGain,baselineLevel:regular.level,patchedLevel:modified.level});
  }
  assert(result.length,'没有经验增长，不能判为通过');
  return result;
}
const args=process.argv.slice(2);
if(args[0]==='--self-test') {
  const fixture=xp=>{const data=new Uint8Array(0x4da3a0);data.set(Buffer.from('UCSD'),4);const save=new SaveFile(data);save.write(0x2af40,4,5);save.write(0x2af40+56,4,xp);save.write(0x2af40+60,2,2);save.write(0x2af40+464,4,0xffffffff);return save.data;};
  assert.equal(compare(fixture(100),fixture(110),fixture(120),2)[0].modGain,20);
  assert.throws(()=>compare(fixture(100),fixture(110),fixture(119),2));
  assert.throws(()=>compare(fixture(100),fixture(100),fixture(100),2));
  assert.throws(()=>compare(fixture(100),fixture(110),fixture(120),NaN));
  const duplicate=new SaveFile(fixture(100));duplicate.write(0x2af40+464,4,5);duplicate.write(0x2af40+928,4,0xffffffff);
  assert.throws(()=>characters(duplicate.data));
  console.log('PASS: XP delta, mismatch, no-op, multiplier and duplicate-ID guards');
} else {
  assert.equal(args.length,4,'Usage: node web/astris-verify.mjs before.DAT baseline.DAT patched.DAT multiplier');
  console.log(JSON.stringify({status:'PASS',characters:compare(...args.slice(0,3).map(path=>readFileSync(path)),Number(args[3]))},null,2));
}
