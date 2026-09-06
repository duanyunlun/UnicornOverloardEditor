import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { gunzipSync, deflateRawSync } from "node:zlib";
import { buildMissionMod } from "../src/exportMissionMod.ts";
import { tacticsForClass, tacticsForPreset } from "../src/tacticsResolve.ts";
import { overlayPchtxtOnCatalog } from "../src/resolvePchtxt.ts";
import { zipStore, unzipTextFiles } from "../src/zipStore.ts";
import { TARGETS, isTarget, isView, acceptsParentMessage } from "../src/frameApi.ts";
import { prepareMissionPatch } from "../src/missionPatch.ts";
import { validateEdits } from "../src/exportValidation.ts";

const catalog = {
  charasets: [{ id: 2, usage: 2 }, { id: 3, usage: 0 }],
  skills: [{ id: 28 }, { id: 442 }], items: [{ id: 1 }],
  equipai_if: [{ id: 0 }, { id: 13 }], class_tactics: [{ class_id: 1 }],
  equiptype_items: [{ id: 1 }],
  equipaiset_presets: [{ id: 1, usage: 2 }, { id: 2, usage: 0 }, { id: 3, usage: 0 }],
  missions: [{ squads: [{ unitset_id: 101, slots: [
    { slot: 0, charaset_id: 2, equipaiset_id: 1 },
    { slot: 1, charaset_id: 2, equipaiset_id: 1 },
  ] }] }],
};
const build = (edits, target = "western", data = catalog) => buildMissionMod(edits, data, "mission_test", target);
const patch = (edits, target, data) => build(edits, target, data).files[0].text;
const editedUnit = (slots) => [{ unitset_id: 101, slots }];
const slot = (position = 0, preset = 1) => ({ slot: position, charaset_id: 2, equipaiset_id: preset });

test("两个目标的 BuildID、TitleID 与六饰品修复", () => {
  for (const target of ["asia", "western"]) {
    const result = build({}, target);
    assert.ok(result.files[0].text.startsWith(`@nsobid-${TARGETS[target].buildId}`));
    assert.ok(result.files.some(file => file.text.includes(TARGETS[target].titleId)));
    for (const address of ["000DD138", "000DD150", "000DD198", "000DD1B0", "000DD1F8", "000DD210"]) assert.ok(result.files[0].text.includes(`${address} 1F2003D5`));
  }
  assert.throws(() => build({}, "invalid"));
});

test("战术、职业主动/被动 IF 与默认装备地址", () => {
  assert.match(patch({ equipaiset_lines: { 1: [{ skill_id: 28, if0: 13 }] } }), /0270AF90 0D000000\n0270AF94 1C000000/);
  assert.match(patch({ class_tactics: [{ class_id: 1, lines: [{ action: 3, skill_id: 28, learn_level: 10, if0: 13 }] }] }), /00D36E40 0A000000/);
  assert.match(patch({ class_tactics: [{ class_id: 1, lines: [{ action: 7, skill_id: 442, learn_level: 5, if0: 13 }] }] }), /027A8CB4 0D000000/);
  assert.match(patch({ equiptype_items: [{ id: 1, item_col0_id: 1, item_col1_id: 1, item_col2_id: 1 }] }), /00D13E3C 0100\n00D13E3E 0100\n00D13E40 0100/);
});

const invalid = [
  { class_equiptypes: [{}] },
  { equipaiset_lines: { 0: [] } },
  { equipaiset_lines: { 1: Array(9).fill({}) } },
  { equipaiset_lines: { 1: [{ if0: 203 }] } },
  { equipaiset_lines: { 1: [{ skill_id: 1.5 }] } },
  { equipaiset_lines: { 1: [{ slot: 8 }] } },
  { equipaiset_lines: { 1: [{ skill_id: 4294967296 }] } },
  { equipaiset_lines: { 1: [{ skill_id: "28" }] } },
  { equipaiset_lines: { 1: [{ skill_id: 27 }] } },
  { equipaiset_creates: [{ key: "x", new_id: 1 }] },
  { equipaiset_creates: [{ key: "x", new_id: 2 }, { key: "y", new_id: 2 }] },
  { equipaiset_creates: [{ key: "x" }, { key: "y" }, { key: "z" }] },
  { equipaiset_creates: [{ key: "x" }, { key: "x" }] },
  { equipaiset_creates: [{ key: "x", temp_id: 1 }] },
  { charasets: [{ charaset_id: 1, gear: [] }] },
  { charasets: [{ charaset_id: 2, gear: [{}, {}, {}, {}, {}] }] },
  { charasets: [{ charaset_id: 2, gear: [{ edited: true, item_id: 65536 }] }] },
  { charasets: [{ charaset_id: 2, duplicate_if_shared: "false" }] },
  { charasets: [{ charaset_id: 2, gear: [{ edited: true, item_id: 1 }] }] },
  { unitsets: editedUnit([slot(6, 0)]) },
  { unitsets: editedUnit([{ ...slot(), flags: 4294967296 }]) },
  { unitsets: editedUnit([slot(0, -1)]) },
  { unitsets: editedUnit([{ ...slot(), equipaiset_alloc_key: "missing" }]) },
  { unitsets: editedUnit([slot(), slot()]) },
  { unitsets: [{ unitset_id: 2099, slots: [slot()] }] },
  { class_tactics: [{ class_id: 1, lines: [{ action: 3 }, { action: 3 }] }] },
  { class_tactics: [{ class_id: 1, lines: [{ action: 3, skill_id: 28, if0: 13 }, { action: 4, skill_id: 28, if0: 0 }] }] },
  { equipaiset_allocations: [{ key: "unbound", lines: [] }] },
  { unitsets: {} },
];
for (const [index, edits] of invalid.entries()) test(`拒绝非法状态 ${index + 1}`, () => assert.throws(() => build(edits)));

test("共享装备须显式确认，且仅写修改的装备槽", () => {
  const result = patch({ charasets: [{ charaset_id: 2, duplicate_if_shared: false, gear: [{ edited: true, item_id: 1 }, { item_id: 1 }] }] });
  assert.match(result, /0276DE30 0100/);
  assert.doesNotMatch(result, /0276DE32/);
  const unknownUsage = structuredClone(catalog);
  delete unknownUsage.charasets[1].usage;
  assert.throws(() => build({ charasets: [{ charaset_id: 3, gear: [{ edited: true, item_id: 1 }] }] }, "asia", unknownUsage));
});

test("私有预设只影响目标槽，不重定向共享源预设的其他槽", () => {
  const result = patch({ equipaiset_allocations: [{ source_id: 1, unitset_id: 101, slot: 0, lines: [{ action: 3 }] }], unitsets: editedUnit([slot(), slot(1)]) });
  const first = 0x28120b8 + 101 * 0x88 + 0x3c;
  assert.ok(result.includes(`${(first + 4).toString(16).toUpperCase().padStart(8, "0")} 03000000`));
  assert.ok(result.includes(`${(first + 16).toString(16).toUpperCase().padStart(8, "0")} 01000000`));
});

test("创建、临时 ID 解析、显式 ID 预留且不修改输入", () => {
  const edits = { equipaiset_creates: [{ key: "new", temp_id: -1, lines: [{ skill_id: 28 }] }, { key: "other", new_id: 3 }], unitsets: editedUnit([slot(5, -1)]) };
  const before = structuredClone(edits);
  const result = patch(edits);
  assert.deepEqual(edits, before);
  const address = 0x28120b8 + 101 * 0x88 + 0x3c + 5 * 12 + 4;
  assert.ok(result.includes(`${address.toString(16).toUpperCase().padStart(8, "0")} 02000000`));
  assert.throws(() => build({ equipaiset_lines: { 3: [] }, equipaiset_creates: [{ key: "x" }, { key: "y" }] }));
});

test("非零空预设不回退职业；职业默认合入装备、锁定等级及标记解析", () => {
  const classes = [{ action: 3, skill_id: 28, if0: 13, if1: 0, learn_level: 10 }];
  const itemSkills = new Map([[1, { skill_id: 442, skill_symbol: "PAS_TEST", if0: 0, if1: 0 }]]);
  const skills = new Map([[28, { id: 28 }], [442, { id: 442 }]]);
  assert.deepEqual(tacticsForPreset(classes, 1, [], skills, new Map()), []);
  const defaults = tacticsForClass(classes, 1, [1, 1], itemSkills, new Map());
  assert.equal(defaults.length, 2);
  assert.equal(defaults[0].locked, true);
  assert.equal(defaults[1].from_item, true);
  const resolved = tacticsForPreset(classes, 1, [{ action: 3, skill_id: 3, if0: 0, if1: 0 }], skills, new Map());
  assert.equal(resolved[0].skill_id, 28);
  assert.equal(resolved[0].if0, 0);
});

test("pchtxt 预览保留原装备，允许清零 IF/装备技能，拒绝错误 BuildID", () => {
  const classes = [{ class_id: 1, class_symbol: "CLASS", lines: [{ action: 3, skill_id: 28, if0: 13, if1: 0 }] }];
  const items = new Map([[1, { skill_id: 442, if0: 13, if1: 0 }]]);
  const address = (0x2787f28 + 28 * 0x130 + 0xac).toString(16);
  const text = `@nsobid-${TARGETS.asia.buildId}\n@flag offset_shift 0x100\n@enabled\n${address} 00000000\n@disabled\n${address} 0D000000`;
  const overlay = overlayPchtxtOnCatalog([{ name: "test", text }], classes, new Map(), new Map(), items, {}, "asia");
  assert.equal(overlay.class_tactics[0].lines[0].if0, 0);
  assert.equal(overlay.item_skills.size, 1);
  assert.equal(overlay.patches_applied, 1);
  assert.throws(() => overlayPchtxtOnCatalog([{ name: "test", text }], classes, new Map(), new Map(), items, {}, "western"));
  const remove = `${text}\n@enabled\n${(0x2716168 + 0xb8 + 0x28).toString(16)} 00000000`;
  assert.equal(overlayPchtxtOnCatalog([{ name: "test", text: remove }], classes, new Map(), new Map(), items).item_skills.size, 0);
});

test("原生 ZIP 中文路径/JSON 回读、CRC、截断、路径和压缩包校验", async () => {
  const files = [{ path: "任务/mission_editor_edits.json", text: JSON.stringify({ equipaiset_lines: { 1: [] } }) }];
  const buffer = await zipStore(files).arrayBuffer();
  assert.deepEqual(await unzipTextFiles(buffer), files.map(file => ({ name: file.path, text: file.text })));
  const corrupt = buffer.slice(0);
  new Uint8Array(corrupt)[30 + new TextEncoder().encode(files[0].path).length] ^= 1;
  await assert.rejects(unzipTextFiles(corrupt));
  await assert.rejects(unzipTextFiles(buffer.slice(0, -1)));
  assert.throws(() => zipStore([{ path: "../bad.json", text: "{}" }]));
  assert.throws(() => zipStore([files[0], files[0]]));
  const plain = await zipStore([{ path: "data.json", text: '{"test":"deflate"}' }]).arrayBuffer();
  const view = new DataView(plain);
  const localSize = 30 + view.getUint16(26, true);
  const originalSize = view.getUint32(18, true);
  const compressed = deflateRawSync(new Uint8Array(plain, localSize, originalSize));
  const packed = Buffer.concat([Buffer.from(plain, 0, localSize), compressed, Buffer.from(plain, localSize + originalSize)]);
  packed.writeUInt16LE(8, 8);
  packed.writeUInt32LE(compressed.length, 18);
  const central = localSize + compressed.length;
  packed.writeUInt16LE(8, central + 10);
  packed.writeUInt32LE(compressed.length, central + 20);
  packed.writeUInt32LE(central, packed.length - 22 + 16);
  assert.equal((await unzipTextFiles(packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.length)))[0].text, '{"test":"deflate"}');
});

test("iframe 四面板、目标和父窗口/同源验证", () => {
  for (const view of ["missions", "classes", "presets", "gear"]) assert.equal(isView(view), true);
  assert.equal(isView("equiptypes"), false);
  assert.equal(isTarget("__proto__"), false);
  const parent = {};
  assert.equal(acceptsParentMessage({ origin: "https://same", source: parent }, "https://same", parent), true);
  assert.equal(acceptsParentMessage({ origin: "https://other", source: parent }, "https://same", parent), false);
  assert.equal(acceptsParentMessage({ origin: "https://same", source: {} }, "https://same", parent), false);
});

test("父层取补丁：无修改返回 null，不额外生成 enginefix", () => {
  const result = prepareMissionPatch({}, catalog, "asia", () => assert.fail("无修改不应弹确认"));
  assert.equal(result.content, null);
  assert.equal(result.patchCount, 0);
  assert.deepEqual(result.files, []);
  const unedited = prepareMissionPatch({ charasets: [{ charaset_id: 3, gear: [{ item_id: 1 }] }] }, catalog, "asia", () => false);
  assert.equal(unedited.content, null);
});

test("父层加载及取补丁：可恢复待确认装备，但未确认绝不导出", () => {
  const edits = { charasets: [{ charaset_id: 2, gear: [{ item_id: 1, edited: true }] }] };
  assert.doesNotThrow(() => validateEdits(edits, catalog, true));
  assert.throws(() => prepareMissionPatch(edits, catalog, "asia", () => false), /未确认/);
  const result = prepareMissionPatch(edits, catalog, "western", () => true);
  assert.match(result.content, /@nsobid-C841FFE/);
  assert.equal(result.edits.charasets[0].duplicate_if_shared, false);
  assert.equal(edits.charasets[0].duplicate_if_shared, undefined);
  assert.throws(() => validateEdits({ equipaiset_lines: { 1: Array(9).fill({}) } }, catalog, true));
  assert.throws(() => prepareMissionPatch({}, catalog, "invalid", () => true));
});

test("父层补丁导出/工程恢复保留预设名称、临时引用与修改", () => {
  const edits = { equipaiset_creates: [{ key: "new", temp_id: -1, symbol: '<img src=x onerror=alert(1)>', lines: [{ skill_id: 28 }] }], unitsets: editedUnit([slot(0, -1)]) };
  const result = prepareMissionPatch(edits, catalog, "asia", () => true);
  const restored = JSON.parse(JSON.stringify(result.edits));
  assert.doesNotThrow(() => validateEdits(restored, catalog, true));
  assert.equal(restored.equipaiset_creates[0].symbol, edits.equipaiset_creates[0].symbol);
  assert.equal(restored.unitsets[0].slots[0].equipaiset_id, -1);
  assert.equal(prepareMissionPatch(restored, catalog, "asia", () => true).content, result.content);
});

test("精简原版目录可重建预览，全部职业和预设可独立导出", () => {
  const data = JSON.parse(gunzipSync(readFileSync(new URL("../../info/mission_catalog.json.gz", import.meta.url))));
  assert.ok(data.item_skills.length > 0);
  const skills = new Map(data.skills.map(row => [row.id, row]));
  const items = new Map(data.item_skills.map(row => [row.id, row]));
  const conditions = new Map(data.equipai_if.map(row => [row.id, row.symbol]));
  const classes = new Map(data.class_tactics.map(row => [row.class_id, row.lines]));
  const presets = new Map(data.equipaiset_presets.map(row => [row.id, row.lines]));
  let slots = 0;
  for (const mission of data.missions) for (const squad of mission.squads) for (const unit of squad.slots) {
    const lines = classes.get(unit.class_id) ?? [];
    const resolved = unit.equipaiset_id === 0
      ? tacticsForClass(lines, Number(mission.enemy_level) || 1, unit.gear.map(gear => gear.item_id), items, conditions)
      : tacticsForPreset(lines, Number(mission.enemy_level) || 1, presets.get(unit.equipaiset_id) ?? [], skills, conditions);
    assert.ok(Array.isArray(resolved));
    if (unit.equipaiset_id && !presets.get(unit.equipaiset_id)?.length) assert.equal(resolved.length, 0);
    slots++;
  }
  for (const row of data.class_tactics) build({ class_tactics: [row] }, "asia", data);
  for (const row of data.equipaiset_presets) build({ equipaiset_lines: { [row.id]: row.lines } }, "western", data);
  assert.ok(slots > 1000);
  console.log(`原版目录验证：${data.missions.length} 关卡，${slots} 单位槽，${classes.size} 职业，${presets.size} 预设。`);
});
