import test from 'node:test';
import assert from 'node:assert/strict';
import {SaveFile} from './save.js';
test('存档字段、导入隔离、原始备份与边界保护',()=>{
  const buffer=new Uint8Array(0x4da3a0);buffer.set(new TextEncoder().encode('UCSD'),4);buffer.fill(255,0x2af40,0x2af40+500*464);buffer.fill(255,0x1b5830,0x1b5830+164*1316);const save=new SaveFile(buffer.buffer);
  save.write(0x20,4,123456);assert.equal(save.read(0x20),123456);assert.equal(save.original[0x20],0);assert.equal(save.characters().length,0);assert.throws(()=>save.write(0x20,1,256));assert.throws(()=>save.read(save.data.length));
  save.addItems([8,9],false,new Map());assert.equal(save.inventory().length,2);assert.equal(save.read(0xa8,3),1);assert.throws(()=>save.addItems(new Array(3800).fill(8),false,new Map()));assert.equal(save.inventory().length,2);
  const character=new Uint8Array(464);character[40]=3;const address=save.importCharacter(character.buffer);assert.equal(save.characters().length,1);assert.equal(save.read(address),1);assert.equal(save.read(address+4),0xffffffff);assert.equal(save.read(0x63984),1);assert.equal(save.read(address+40,1),3);assert.throws(()=>save.importCharacter(new ArrayBuffer(8)));
  assert.throws(()=>new SaveFile(new ArrayBuffer(8)));
});
test('多角色导入整批校验，保留原始备份、唯一ID和双向亲密度',()=>{
  const buffer=new Uint8Array(0x4da3a0);buffer.set(new TextEncoder().encode('UCSD'),4);buffer.fill(255,0x2af40,0x2af40+500*464);buffer.fill(255,0x1b5830,0x1b5830+164*1316);const save=new SaveFile(buffer);
  const character=new Uint8Array(464);character.fill(255,76,92);character[40]=3;
  assert.throws(()=>save.importCharacters([character,new Uint8Array(8)]));assert.deepEqual(save.data,save.original);
  const addresses=save.importCharacters([character,character]);assert.deepEqual(addresses.map(address=>save.read(address)),[1,2]);assert.equal(save.read(0x63984),2);
  assert.deepEqual(save.bonds(addresses[0]).map(address=>save.read(address)),[2]);assert.deepEqual(save.bonds(addresses[1]).map(address=>save.read(address)),[1]);
  assert(save.data.slice(addresses[1]+76,addresses[1]+92).every(byte=>byte===0));assert.equal(character[76],255);assert.deepEqual(save.original,buffer);
  const snapshot=save.data.slice();assert.throws(()=>save.importCharacters(Array(499).fill(character)));assert.deepEqual(save.data,snapshot);
  save.write(0x63980,4,0xfffffffd);const idSnapshot=save.data.slice();assert.throws(()=>save.importCharacters([character,character]));assert.deepEqual(save.data,idSnapshot);
  save.write(0x63980,4,2);save.write(0x63984,4,0xffffffff);const countSnapshot=save.data.slice();assert.throws(()=>save.importCharacters([character]));assert.deepEqual(save.data,countSnapshot);
});
