# AGENTS.md — chatluna-plugin-onebot-webqq

ChatLuna v2 外部插件，由 `koishi-plugin-onebot-webqq` 迁移。保留原版 WebQQ 浮动观察窗和聊天胶囊，接入层使用 Cordis 4、Satori、React 与 v2 WebUI。协议为 MIT。

## 源码与运行

- 本目录是唯一源码；`chatluna-v2-mirror/external/onebot-webqq` 是单向同步的 workspace 副本。只在本目录修改源码，不在副本修补。
- `@chatluna/*` 尚依赖 v2 workspace；本目录不安装依赖、不保存锁文件与构建产物。
- 本目录执行 `node scripts/sync-to-v2.mjs --once`，再在 v2 根目录执行下列命令。v2 位置由同步脚本默认路径或 `CHATLUNA_V2_ROOT` 决定。

## 验证命令

1. `yarn yakumo build onebot-webqq`
2. `yarn workspace chatluna-plugin-onebot-webqq typecheck`
3. `yarn workspace chatluna-plugin-onebot-webqq test`

测试包括生产 CSS 守卫，必须先构建。发布前清理副本的 `lib`、`dist`、`tsconfig.tsbuildinfo` 再构建，防止增量构建留下旧声明。构建成功不代表已经发布。

## 数据安全

- 浏览器联调用独立实例、独立数据库与虚拟 OneBot 机器人；不将真实账号、会话或口令复制到夹具中。
- `webQQMockEnvironment` 只允许虚拟 OneBot 机器人，与真实机器人候选集合互斥；发送、撤回与群管理是实际 OneBot 操作，不是 UI 演示。
- 不记录口令或携带口令的访问链接。浏览器工具收尾关闭本次会话并清理其临时文件。
- 按用户要求提交或发布，不自行初始化 Git、创建分支或提交。

## 子目录说明

- `src/AGENTS.md`：服务端、OneBot 协议、ChatLuna 状态与 WebUI 契约。
- `client/AGENTS.md`：React UI、主题、毛玻璃与滚动条。

修改对应目录前读取该目录说明。增加或删除子目录说明时更新本清单，并运行登记守卫测试。
