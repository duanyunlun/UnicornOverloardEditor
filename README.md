# UnicornOverloardEditor

《独角兽之王》存档与 MOD 浏览器编辑器，支持简体中文、English、日本語。

**[打开 Web 编辑器](https://duanyunlun.github.io/UnicornOverloardEditor/)**

从当前版本起，开发与发布全面转向 Web，不再发布 Windows/macOS 桌面 App。旧 Avalonia 源码仅保留作历史参考；公共名称、译文、原始表和补丁模板已移入 `web/`，Web 构建不需要 .NET。

## 功能

- 存档：金币、声望、难度、角色职业/等级/经验/能力/亲密度、十支部队。
- 角色：导出、替换，以及一次导入多个 `.uocd`；批量输入先整体验证，失败不部分写入。
- 库存：筛选并多选添加道具/装备、补齐、替换、批量数量。
- MOD：技能、战斗、角色、职业、据点、采矿、商店、编队，保留原有分类。
- 任务成员与装备、战术预设、职业默认战术和默认装备；工程 JSON 往返、上游 JSON/ZIP 导入、pchtxt 预览与统一冲突检查。
- 亚洲中文版及欧美版 v1.0.5；亚洲经验倍率和动态等级需自行选择合法提取的原始未压缩 `main`，由浏览器本地合包。
- 文本/CPK 编辑仍按此前要求暂缓，不计入已迁移功能；具体核对见[Web 迁移验收清单](docs/Web迁移验收清单.md)。

## 数据安全

所有编辑在浏览器内存中完成，不上传游戏文件，也不覆盖源存档。打开存档后可下载原始备份，修改后下载副本；关闭网页前务必保存工程或存档。浏览器不会自动写入模拟器的存档/MOD目录。

MOD ZIP 面向 Astris 等模拟器，安装前停止游戏，禁用冲突旧 MOD，安装后冷启动。亚洲运行时输出含游戏程序，不得公开分发。静态检查不等同于所有游戏场景验证通过，具体实测边界见[亚洲版验证记录](docs/亚洲版经验与等级补丁验证.md)。

## 开发与发布

需要 Node.js 24 和 npm，在仓库根目录运行：

```sh
npm ci --prefix web/mission
npm test --prefix web
npm run build --prefix web/mission
npm run build --prefix web
python3 -m http.server 8766 --bind 127.0.0.1 --directory web/dist
```

打开 `http://127.0.0.1:8766/`。不要通过 `file://` 双击网页。main 的 Web 相关更新自动部署 GitHub Pages；手动 Release 只生成 Web 静态 ZIP，不再构建桌面安装包。详见[构建与部署](docs/浏览器版构建与部署.md)。

## 来源

- [原始存档编辑项目](https://github.com/turtle-insect/UnicornOverlord)
- [UOSquadEditor](https://github.com/thu1478/UOSquadEditor)
- [第三方 MOD 来源与许可](docs/第三方MOD来源.md)
- [MOD 功能对齐清单](docs/MOD功能对齐清单.md)
- [开发与验证说明](docs/开发与验证.md)

---

## English

**[Open the Web editor](https://duanyunlun.github.io/UnicornOverloardEditor/)**

Unicorn Overlord save and MOD editor for modern browsers, with Simplified Chinese, English and Japanese interfaces. Development and releases now target Web only; the old Avalonia application is retained as historical source, not a maintained release target.

Save editing includes character import/export (including multiple `.uocd` files), inventory multi-selection, Rapport and units. The original eight MOD categories include mission squads, presets, class defaults, default gear, project import/export and conflict detection. Text/CPK editing remains deferred under the earlier scope and is not claimed as migrated.

Files stay in browser memory. Download the original backup and edited copy; save changes before closing the page. The browser does not install files into your emulator. Asian runtime patches require your own unmodified, uncompressed v1.0.5 `main`; generated game code must not be redistributed. Stop the game before installing MODs and cold-start afterward.

Build using the commands above (Node.js 24 required, no .NET). Serve `web/dist` over HTTP. GitHub Pages is the primary release; manual releases provide a static Web ZIP instead of desktop binaries.
