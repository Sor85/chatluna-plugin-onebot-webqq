# chatluna-plugin-onebot-webqq

ChatLuna v2 的 OneBot WebQQ 与聊天状态胶囊，由 `koishi-plugin-onebot-webqq` 迁移。前端使用 React 和 `@chatluna/ui-kit`，保留原版浮动窗口、联系人列表、聊天布局及 QQ / TIM 气泡样式。

> 当前为开发联调版本，尚未发布。已通过构建、类型检查及迁移回归测试；真实 QQ 实现、并发多机器人和完整 ChatLuna 回合仍需端到端验证，不能将沙盒验证视为真机验证。

## 功能

- 全局聊天胶囊、机器人切换、拖动定位与未读徽标。拖到左右边缘外侧时贴边收起，只保留一小段把手；悬停、键盘聚焦或观察窗打开时滑出。
- 最近会话、好友分组、群组、群公告、群成员与资料卡。
- 历史消息、实时消息、回复、撤回、多选合并转发、贴表情及通知申请处理。
- 文本、图片、表情、引用、卡片、语音播放/转写、附件与图片缩放预览。
- ChatLuna v2 思考状态、角色 `<think>` 内心活动、token 用量、TTFT / TPS / 总耗时与角色好感度。
- 明亮、暗色、跟随宿主主题、自定义强调色；毛玻璃复用 v2 ui-kit 令牌。

## 接入

插件目前需要放到 ChatLuna v2 的 workspace 中构建。源码目录执行：

```sh
node scripts/sync-to-v2.mjs --once
```

在 v2 根目录执行：

```sh
yarn install
yarn yakumo build onebot-webqq
yarn workspace chatluna-plugin-onebot-webqq typecheck
yarn workspace chatluna-plugin-onebot-webqq test
```

在 v2 实例中添加并启用 `chatluna-plugin-onebot-webqq`。插件使用宿主已有的 Satori、HTTP 服务、登录认证与 WebUI，不另开 Web 服务端口。

## 配置说明

- `onebotProtocol`：NapCat、LLBot 或 SnowLuma。默认 NapCat；SnowLuma 使用 `message_id` 分页，不能只替换显示名称而沿用 NapCat 游标。
- `onebotUseRuntimeBots` / `onebotSelfIds`：使用全部可用 OneBot 机器人或指定账号。
- `webQQMockEnvironment`：只显示虚拟 OneBot 机器人；可搭配 OneBot 沙盒联调，不操作真实账号。
- `enableWebQQSend`：显示消息发送区，默认关闭。
- `enableCapsuleFrostedGlass` / `enableWebQQFrostedGlass`：独立控制胶囊与观察窗的毛玻璃。
- `webQQStorageBackend`：`database` 或 `browser`。数据库模式使用宿主数据库；浏览器模式的消息缓存只在当前浏览器。
- `showWebQQAffinity`：显示当前角色预设下 `favor` 字段的好感度，需要 v2 角色引擎。

其他字段通过 v2 插件配置页编辑。SnowLuma 的近期联系人接口目前为空，最近会话由本地观察到的消息补充；私聊表情回应不受 SnowLuma 支持。

## 与旧版的边界

旧版关系等级、好感度 scopeId 与日程活动没有等价的 v2 数据源，已移除。媒体、群管理、历史读取和申请处理仍受 OneBot 实现能力与账号权限限制。迁移不会自动导入原 Koishi 数据库或浏览器缓存。

## 验证说明

Chrome 与 Firefox 的聊天、消息发送、菜单、查找和 Dialog 已在隔离沙盒中做过交互检查。Chrome 的生产毛玻璃及亮暗主题已确认；本机 Playwright Firefox 在独立原生测试页中也不绘制背景模糊，因此 Firefox 的模糊视觉效果仍需在实际用户浏览器确认，布局与交互不受此项检查限制。

## License

MIT
