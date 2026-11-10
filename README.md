# chatluna-plugin-onebot-webqq

[![npm](https://img.shields.io/npm/v/chatluna-plugin-onebot-webqq)](https://www.npmjs.com/package/chatluna-plugin-onebot-webqq)

ChatLuna v2 插件：在 WebUI 里用 QQ 风格的浮动窗口查看和收发 OneBot 机器人的消息，并用一枚聊天胶囊实时显示 ChatLuna 的思考状态、角色内心活动、token 用量与好感度。

## 功能

- **聊天胶囊**：常驻 WebUI 的小胶囊，显示当前机器人、未读数与 ChatLuna 回复状态；多个机器人时可切换。可拖到任意位置，拖出左右边缘时贴边收起，悬停后滑出。
- **WebQQ 观察窗**：最近会话、好友分组、群组、群公告、群成员与资料卡；支持历史与实时消息、回复、撤回、多选合并转发、表情回应和好友/入群申请处理。
- **消息内容**：文本、图片、表情、引用、卡片、语音播放与转写、文件，图片可缩放预览。
- **ChatLuna 回合信息**：思考中状态、角色 `<think>` 内心活动、输入输出 token、TTFT / TPS / 总耗时，以及角色引擎记录的好感度。
- **外观**：TIM / QQ 两种气泡样式，明亮、暗色或跟随 WebUI 主题，自定义强调色，胶囊与观察窗可分别开关毛玻璃。

## 安装

在 ChatLuna v2 的插件市场搜索 `onebot-webqq` 安装，或在项目目录执行：

```sh
yarn add chatluna-plugin-onebot-webqq
```

启用后 WebUI 右下角出现聊天胶囊，点击打开 WebQQ 观察窗。插件复用 WebUI 的登录与 HTTP 服务，不另开端口。

## 配置

在插件配置页修改，常用项：

| 配置项 | 说明 |
| --- | --- |
| OneBot 实现 | NapCat、LLBot 或 SnowLuma，决定历史消息的分页方式，需与实际使用的实现一致 |
| 使用全部 OneBot 机器人 | 关闭后只使用「机器人 selfId 集合」中列出的账号 |
| 状态存储位置 | 最近会话、未读数与消息缓存存进数据库，或只存在当前浏览器 |
| 消息发送 | 显示输入框，可从观察窗直接发消息，默认关闭 |
| 显示好感度 | 在昵称旁显示当前角色预设的好感度，需要 ChatLuna 角色引擎 |
| 模拟环境 | 只使用其他插件提供的虚拟机器人（如 OneBot 沙盒），不接触真实账号 |

## 已知限制

- 媒体、群管理、历史读取与申请处理取决于 OneBot 实现的能力和机器人账号的权限。
- SnowLuma 不提供近期联系人列表，最近会话由插件观察到的消息补充；私聊不支持表情回应。

## License

MIT
