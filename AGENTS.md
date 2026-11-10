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

测试包括生产 CSS 守卫，必须先构建。构建成功不代表已经发布。

## 发布

- 在本机执行 `node scripts/publish.mjs`；`--dry-run` 只演练，账号开了两步验证时加 `--otp=<验证码>`。不经 yarn：本目录没有 `yarn.lock`，Yarn 4 会在启动脚本前报错；无交互终端时 npm 不等浏览器授权，直接以 `EOTP` 退出。
- 脚本要求工作区干净、提交已推送、npm 已登录、`v<版本>` tag 不存在。它同步副本，清空 `lib`、`dist`、`tsconfig.tsbuildinfo` 后构建、类型检查与测试，再 `yarn pack`、解压后从目录 `npm publish`，最后打 `v<版本>` tag 并推送。发版前只需修改并推送 `package.json` 的 `version`。
- 清空产物：同步不清理旧产物，残留的已删除模块声明会被打进包；`tsconfig.tsbuildinfo` 还在时 tsc 不重新生成声明。`yarn pack` 才会改写 `workspace:*`。从目录发布时 npm 才把 README 写进 `readme` 元数据，插件市场详情页读的是它。
- npm 可能先出现 `0.0.0-stage` 占位版本，确认 `latest` 指向新版本前不判定为发布失败。v2 公开前不走 CI 发布。

## 数据安全

- 浏览器联调用独立实例、独立数据库与虚拟 OneBot 机器人；不将真实账号、会话或口令复制到夹具中。
- `webQQMockEnvironment` 只允许虚拟 OneBot 机器人，与真实机器人候选集合互斥；发送、撤回与群管理是实际 OneBot 操作，不是 UI 演示。
- 不记录口令或携带口令的访问链接。浏览器工具收尾关闭本次会话并清理其临时文件。
- 按用户要求提交或发布，不自行初始化 Git、创建分支或提交。

## 子目录说明

- `src/AGENTS.md`：服务端、OneBot 协议、ChatLuna 状态与 WebUI 契约。
- `client/AGENTS.md`：React UI、主题、毛玻璃与滚动条。

修改对应目录前读取该目录说明。增加或删除子目录说明时更新本清单，并运行登记守卫测试。
